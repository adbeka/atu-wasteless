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
function applyReference({ methods, types }, { orgId = null, matchOrgs = true } = {}) {
  const stats = { methodsAdded: 0, methodsUpdated: 0, typesAdded: 0, typesUpdated: 0 };
  db.exec('BEGIN');
  try {
    for (const m of methods) {
      const ex = db.prepare('SELECT id FROM disposal_methods WHERE code=? OR name=?').get(m.code, m.name);
      const co2 = m.landfill || m.co2PerT == null ? null : m.co2PerT / 1000;
      if (ex) { db.prepare('UPDATE disposal_methods SET code=?, name=?, is_recycling=?, co2_factor=?, rank=?, note=? WHERE id=?').run(m.code, m.name, m.landfill ? 0 : 1, co2, m.rank, m.note, ex.id); stats.methodsUpdated++; }
      else { db.prepare('INSERT INTO disposal_methods (code, name, is_recycling, co2_factor, rank, note) VALUES (?,?,?,?,?,?)').run(m.code, m.name, m.landfill ? 0 : 1, co2, m.rank, m.note); stats.methodsAdded++; }
    }
    const byCode = (c) => c && db.prepare('SELECT id FROM disposal_methods WHERE code=?').get(c)?.id;
    const tbo = byCode('TBO') || db.prepare('SELECT id FROM disposal_methods ORDER BY rank DESC, id LIMIT 1').get()?.id;
    const allOrgs = db.prepare('SELECT * FROM organizations WHERE active=1').all();
    for (const t of types) {
      const targets = orgId ? [orgId] : matchOrgs ? orgsForText(t.orgs, allOrgs).map((o) => o.id) : [];
      const rec = byCode(t.recCode) || null;
      for (const oid of targets.length ? targets : [null]) {
        const ex = db.prepare('SELECT id FROM waste_types WHERE lower(name)=lower(?) AND org_id IS ?').get(t.name, oid);
        const vals = [t.unit, t.unit === 'л' ? 0.92 : 1, t.category, rec, t.recyclable, t.landfillCo2PerT / 1000, t.note || null];
        if (ex) {
          db.prepare('UPDATE waste_types SET unit=?, kg_per_unit=?, category=?, recommended_method_id=?, recyclable=?, co2_factor=?, note=? WHERE id=?').run(...vals, ex.id);
          stats.typesUpdated++;
        } else {
          const def = t.unit === 'л' && byCode('OIL') ? byCode('OIL') : tbo; // способ «как сейчас» — ТБО (по образцам), масло — спецорганизация
          db.prepare(`INSERT INTO waste_types (org_id, name, unit, kg_per_unit, category, recommended_method_id, recyclable, co2_factor, note, default_method_id, max_per_entry)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(oid, t.name, ...vals, def, t.category === 'organic' ? 200 : 60);
          stats.typesAdded++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return stats;
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
  retail: { label: 'Розничная торговля', orgLabel: 'Магазин', orgsLabel: 'Магазины', example: 'магазины сети, распределительный центр', types: [
    t('Просроченная продукция', 'organic', 'кг', 1, 'Биогаз (анаэробное сбраживание)', L, 'Анализ по товарным группам'),
    t('Продукция с истекающим сроком (уценка/передача)', 'organic', 'кг', 2, 'Передача (фудшеринг), иначе компост', L, 'Лучше предотвратить: уценка, передача'),
    t('Фрукты и овощи (потеря товарного вида)', 'organic', 'кг', 2, 'Корм животным, иначе компост', L),
    t('Хлебобулочные изделия (возврат)', 'organic', 'кг', 2, 'Корм животным, иначе компост', L),
    t('Картон', 'recyclable', 'кг', 2, 'Сдача на переработку', C),
    t('Стрейч-плёнка', 'recyclable', 'кг', 1, 'Сдача на переработку', G, 'Допущение: коэффициенты как у стекла'),
  ] },
};

function getSettings() {
  const s = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const ind = INDUSTRIES[s.industry] ? s.industry : 'university';
  return {
    industry: ind, industryLabel: INDUSTRIES[ind].label,
    systemName: s.systemName || 'Wasteless',
    company: s.company || 'АО «Алматинский технологический университет»',
    orgLabel: s.orgLabel || INDUSTRIES[ind].orgLabel, orgsLabel: s.orgsLabel || INDUSTRIES[ind].orgsLabel,
    industries: Object.entries(INDUSTRIES).map(([k, v]) => ({ key: k, label: v.label, example: v.example, orgLabel: v.orgLabel })),
  };
}
function setSettings(b) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  for (const k of ['systemName', 'company', 'orgLabel', 'orgsLabel', 'industry']) if (b[k] != null) up.run(k, String(b[k]).slice(0, 120));
  if (b.industry && INDUSTRIES[b.industry] && b.resetLabels) { up.run('orgLabel', INDUSTRIES[b.industry].orgLabel); up.run('orgsLabel', INDUSTRIES[b.industry].orgsLabel); }
}
function applyIndustry(key, orgId) {
  const ind = INDUSTRIES[key];
  if (!ind?.types) throw new Error('Для этой отрасли используйте импорт справочника из Excel');
  return applyReference({ methods: [], types: ind.types }, { orgId: orgId || null, matchOrgs: false });
}

module.exports = { parseWorkbook, applyReference, applyIndustry, getSettings, setSettings, INDUSTRIES };
