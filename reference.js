// Справочники: импорт из Excel (формат «Справочники для Трека 1») и отраслевые шаблоны.
// Один и тот же формат подходит для университета, пищевого производства, общепита и ритейла —
// новая организация/отрасль подключается загрузкой справочника, без изменения кода.
const ExcelJS = require('exceljs');
const { db } = require('./db');

const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') return String(v.result ?? v.text ?? (v.richText ? v.richText.map((x) => x.text).join('') : ''));
  return String(v);
};
const cellNum = (v) => { const t = cellText(v).replace(',', '.').replace(/\s/g, ''); return t === '' ? null : Number(t); };
const CATEGORY = { 'органические': 'organic', 'вторсырьё': 'recyclable', 'вторсырье': 'recyclable', 'специальные': 'special', 'смешанные': 'mixed' };
const RECYCLABLE = { 'да': 2, 'частично': 1, 'нет': 0 };
// рекомендуемый способ (свободный текст) → код способа: берём первое упомянутое
const METHOD_HINTS = [[/фудшеринг|благотвор|передач[аи] нереал|^передача \(/i, 'DONATE'], [/корм/i, 'FEED'], [/биодизел|спецорганизац/i, 'OIL'],
  [/компост/i, 'COMPOST'], [/биогаз|анаэроб/i, 'AD'], [/переработк|разделить|вторсыр/i, 'RECYCLE'], [/тбо|полигон/i, 'TBO']];
function methodCodeFromText(t) {
  let best = null, pos = Infinity;
  for (const [re, code] of METHOD_HINTS) { const m = re.exec(t); if (m && m.index < pos) { pos = m.index; best = code; } }
  return best;
}

// ---------- разбор книги Excel ----------
async function parseWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const find = (re) => wb.worksheets.find((s) => re.test(s.name));
  const wsM = find(/способ/i), wsT = find(/вид/i);
  if (!wsT) throw new Error('В файле нет листа «Виды отходов»');
  const rows = (ws) => { const out = []; ws.eachRow((r, i) => { if (i > 1) out.push(r.values.slice(1)); }); return out; };

  const methods = wsM ? rows(wsM).filter((r) => cellText(r[0]) && cellText(r[1])).map((r) => {
    const code = cellText(r[0]).trim().toUpperCase();
    return { code, name: cellText(r[1]).trim(), for: cellText(r[2]), co2PerT: cellNum(r[3]), rank: cellNum(r[4]) ?? 5, note: cellText(r[5]), landfill: code === 'TBO' };
  }) : [];
  const types = rows(wsT).filter((r) => cellText(r[0]).trim()).map((r) => ({
    name: cellText(r[0]).trim(), orgs: cellText(r[1]), category: CATEGORY[cellText(r[2]).trim().toLowerCase()] || 'organic',
    unit: /^л/i.test(cellText(r[3]).trim()) ? 'л' : 'кг', recyclable: RECYCLABLE[cellText(r[4]).trim().toLowerCase()] ?? 0,
    recText: cellText(r[5]), recCode: methodCodeFromText(cellText(r[5])), landfillCo2PerT: cellNum(r[6]) ?? 700.21, note: cellText(r[9]),
  }));
  return { methods, types };
}

// ---------- применение справочника к базе (upsert, без удаления) ----------
function orgsForText(text, orgs) {
  const t = text.toLowerCase();
  return orgs.filter((o) => (o.match_key || o.short).toLowerCase().split('|').some((k) => k && t.includes(k)));
}
// Применить справочник к компании (tenantId): виды отходов — в её подразделения.
// Способы утилизации общие для всей платформы — их меняет только владелец платформы (withMethods).
async function applyReference({ methods, types }, { tenantId, orgId = null, matchOrgs = true, withMethods = false, defaultMethod = 'TBO' } = {}) {
  const stats = { methodsAdded: 0, methodsUpdated: 0, typesAdded: 0, typesUpdated: 0, methodsSkipped: withMethods ? 0 : methods.length };
  return db.tx(async () => {
    if (withMethods) for (const m of methods) {
      const ex = await db.prepare('SELECT id FROM disposal_methods WHERE code=? OR name=?').get(m.code, m.name);
      const co2 = m.landfill || m.co2PerT == null ? null : m.co2PerT / 1000;
      if (ex) { await db.prepare('UPDATE disposal_methods SET code=?, name=?, is_recycling=?, co2_factor=?, rank=?, note=? WHERE id=?').run(m.code, m.name, m.landfill ? 0 : 1, co2, m.rank, m.note, ex.id); stats.methodsUpdated++; }
      else { await db.prepare('INSERT INTO disposal_methods (code, name, is_recycling, co2_factor, rank, note) VALUES (?,?,?,?,?,?)').run(m.code, m.name, m.landfill ? 0 : 1, co2, m.rank, m.note); stats.methodsAdded++; }
    }
    const codes = Object.fromEntries((await db.prepare('SELECT id, code FROM disposal_methods').all()).map((r) => [r.code, r.id]));
    const byCode = (c) => (c && codes[c]) || null;
    const tbo = byCode(defaultMethod) || byCode('TBO') || (await db.prepare('SELECT id FROM disposal_methods ORDER BY rank DESC, id LIMIT 1').get())?.id;
    const allOrgs = await db.prepare('SELECT * FROM organizations WHERE active=1 AND tenant_id=?').all(+tenantId);
    for (const t of types) {
      const targets = orgId ? [orgId] : matchOrgs ? orgsForText(t.orgs, allOrgs).map((o) => o.id) : allOrgs.map((o) => o.id);
      const rec = byCode(t.recCode) || null;
      for (const oid of targets) {
        const ex = await db.prepare('SELECT id FROM waste_types WHERE lower(name)=lower(?) AND org_id=?').get(t.name, oid);
        const vals = [t.unit, t.unit === 'л' ? 0.92 : 1, t.category, rec, t.recyclable, t.landfillCo2PerT / 1000, t.note || null];
        if (ex) {
          await db.prepare('UPDATE waste_types SET unit=?, kg_per_unit=?, category=?, recommended_method_id=?, recyclable=?, co2_factor=?, note=? WHERE id=?').run(...vals, ex.id);
          stats.typesUpdated++;
        } else {
          const def = t.unit === 'л' && byCode('OIL') ? byCode('OIL') : tbo; // способ «как сейчас» — ТБО (по образцам), масло — спецорганизация
          await db.prepare(`INSERT INTO waste_types (org_id, name, unit, kg_per_unit, category, recommended_method_id, recyclable, co2_factor, note, default_method_id, max_per_entry)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(oid, t.name, ...vals, def, t.category === 'organic' ? 200 : 60);
          stats.typesAdded++;
        }
      }
    }
    return stats;
  });
}

// ---------- отраслевые шаблоны ----------
// Способы утилизации и коэффициенты — те же (DEFRA 2024), меняются виды отходов и термины.
const L = 700.21, C = 1164.39, G = 8.88; // кг CO2e/т при захоронении: пищевые, картон, инертные (стекло/пластик/металл)
const t = (name, category, unit, recyclable, recText, landfillCo2PerT, note = '') => ({ name, orgs: '', category, unit, recyclable, recText, recCode: methodCodeFromText(recText), landfillCo2PerT, note });
const INDUSTRIES = {
  university: { label: 'Университет / кампус', orgLabel: 'Организация', orgsLabel: 'Организации', example: 'кафедры, столовые, кофейни, гостиница', types: null },
  food: { label: 'Пищевое производство', orgLabel: 'Цех', orgsLabel: 'Цеха', example: 'сырьевой, производственный, упаковочный цеха', types: [
    t('Брак готовой продукции', 'organic', 'кг', 2, 'Корм животным, иначе биогаз', L, 'Фиксировать причину брака'),
    t('Технологические потери и обрезь', 'organic', 'кг', 2, 'Биогаз (анаэробное сбраживание)', L),
    t('Некондиционное сырьё', 'organic', 'кг', 2, 'Компостирование / биогаз', L, 'Претензия поставщику'),
    t('Просроченное сырьё', 'organic', 'кг', 1, 'Биогаз (анаэробное сбраживание)', L, 'Сигнал к пересмотру закупок'),
    t('Отходы очистки сырья', 'organic', 'кг', 2, 'Компостирование', L),
    t('Картонная тара от сырья', 'recyclable', 'кг', 2, 'Сдача на переработку', C),
    t('Полимерная плёнка', 'recyclable', 'кг', 1, 'Сдача на переработку', G, 'Допущение: коэффициенты как у стекла'),
    t('Отработанное масло', 'special', 'л', 2, 'Сдача спецорганизации (биодизель)', L, '1 л ≈ 0,92 кг'),
  ] },
  horeca: { label: 'Общепит и HoReCa', orgLabel: 'Заведение', orgsLabel: 'Заведения', example: 'рестораны, кафе, столовые, кейтеринг', types: [
    t('Пищевые отходы из зала', 'organic', 'кг', 2, 'Компостирование / биогаз', L),
    t('Остатки нереализованной продукции', 'organic', 'кг', 2, 'Передача (фудшеринг), иначе компост', L),
    t('Очистки овощей', 'organic', 'кг', 2, 'Компостирование', L),
    t('Хлеб', 'organic', 'кг', 2, 'Корм животным, иначе компост', L),
    t('Кофейный жмых', 'organic', 'кг', 2, 'Компостирование', L),
    t('Отработанное масло', 'special', 'л', 2, 'Сдача спецорганизации (биодизель)', L),
    t('Картонная тара', 'recyclable', 'кг', 2, 'Сдача на переработку', C),
    t('Стеклобутылка', 'recyclable', 'кг', 2, 'Сдача на переработку', G),
  ] },
  // личный учёт: домашняя кухня
  home: { label: 'Дом / личный учёт', orgLabel: 'Кухня', orgsLabel: 'Кухни', example: 'домашняя кухня', personal: true, types: [
    t('Остатки еды с тарелок', 'organic', 'кг', 2, 'Компостирование', L, 'Готовить меньше порций, хранить остатки в контейнерах'),
    t('Испорченные продукты', 'organic', 'кг', 2, 'Компостирование', L, 'Сигнал покупать меньше и проверять сроки'),
    t('Очистки овощей и фруктов', 'organic', 'кг', 2, 'Компостирование', L),
    t('Хлеб', 'organic', 'кг', 2, 'Корм животным, иначе компост', L, 'Сухари, гренки, заморозка'),
    t('Кофейная гуща и чай', 'organic', 'кг', 2, 'Компостирование', L),
    t('Картон и бумажная упаковка', 'recyclable', 'кг', 2, 'Сдача на переработку', C),
    t('Пластик и ПЭТ', 'recyclable', 'кг', 1, 'Сдача на переработку', G, 'Допущение: коэффициенты как у стекла'),
  ] },
  retail: { label: 'Розничная торговля', orgLabel: 'Магазин', orgsLabel: 'Магазины', example: 'магазины сети, распределительный центр', types: [
    t('Просроченная продукция', 'organic', 'кг', 1, 'Биогаз (анаэробное сбраживание)', L, 'Анализ по товарным группам'),
    t('Продукция с истекающим сроком (уценка/передача)', 'organic', 'кг', 2, 'Передача (фудшеринг), иначе компост', L, 'Лучше предотвратить: уценка, передача'),
    t('Фрукты и овощи (потеря товарного вида)', 'organic', 'кг', 2, 'Корм животным, иначе компост', L),
    t('Хлебобулочные изделия (возврат)', 'organic', 'кг', 2, 'Корм животным, иначе компост', L),
    t('Картон', 'recyclable', 'кг', 2, 'Сдача на переработку', C),
    t('Стрейч-плёнка', 'recyclable', 'кг', 1, 'Сдача на переработку', G, 'Допущение: коэффициенты как у стекла'),
  ] },
};

// настройки компании (у каждой — свои): название, термины, отрасль, скидка за свою кружку
async function getSettings(tenantId) {
  const tn = tenantId ? await db.prepare('SELECT * FROM tenants WHERE id=?').get(+tenantId) : null;
  const s = tn ? Object.fromEntries((await db.prepare('SELECT key, value FROM settings WHERE tenant_id=?').all(tn.id)).map((r) => [r.key, r.value])) : {};
  const ind = INDUSTRIES[s.industry] ? s.industry : INDUSTRIES[tn?.industry] ? tn.industry : 'university';
  return {
    tenantKind: tn?.kind || null,
    industry: ind, industryLabel: INDUSTRIES[ind].label,
    systemName: s.systemName || 'Wasteless',
    company: s.company || tn?.name || '',
    orgLabel: s.orgLabel || INDUSTRIES[ind].orgLabel, orgsLabel: s.orgsLabel || INDUSTRIES[ind].orgsLabel,
    cupDiscountKzt: Number(s.cupDiscountKzt ?? 100), // скидка в кофейне за свою кружку, ₸
    industries: Object.entries(INDUSTRIES).filter(([, v]) => !v.personal).map(([k, v]) => ({ key: k, label: v.label, example: v.example, orgLabel: v.orgLabel })),
  };
}
async function setSettings(tenantId, b) {
  const up = db.prepare('INSERT INTO settings (tenant_id, key, value) VALUES (?,?,?) ON CONFLICT(tenant_id, key) DO UPDATE SET value=excluded.value');
  for (const k of ['systemName', 'company', 'orgLabel', 'orgsLabel', 'industry', 'cupDiscountKzt']) if (b[k] != null) await up.run(+tenantId, k, String(b[k]).slice(0, 120));
  if (b.industry && INDUSTRIES[b.industry] && b.resetLabels) { await up.run(+tenantId, 'orgLabel', INDUSTRIES[b.industry].orgLabel); await up.run(+tenantId, 'orgsLabel', INDUSTRIES[b.industry].orgsLabel); }
  if (b.company) await db.prepare('UPDATE tenants SET name=? WHERE id=?').run(String(b.company).slice(0, 120), +tenantId);
}
// отраслевой шаблон видов отходов; у университета своего шаблона нет (справочник из Excel) — берём общепит
async function applyIndustry(tenantId, key, orgId) {
  const ind = INDUSTRIES[key]?.types ? INDUSTRIES[key] : key === 'university' ? INDUSTRIES.horeca : null;
  if (!ind) throw new Error('Для этой отрасли используйте импорт справочника из Excel');
  return applyReference({ methods: [], types: ind.types }, { tenantId, orgId: orgId || null, matchOrgs: false, defaultMethod: ind.personal ? 'TBO_BIN' : 'TBO' });
}

module.exports = { parseWorkbook, applyReference, applyIndustry, getSettings, setSettings, INDUSTRIES };
