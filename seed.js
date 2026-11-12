// Демо-данные: 5 организаций АТУ. Виды отходов, способы утилизации и коэффициенты CO₂ загружаются
// из официального файла организаторов reference/Справочники_Трек1.xlsx (DEFRA 2024).
// Взвешивания синтетические: 4 закрытых месяца + текущий месяц (черновики). Запуск: npm run seed
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, hashPassword } = require('./db');
const { parseWorkbook, applyReference } = require('./reference');

const REF_FILE = path.join(__dirname, 'reference', 'Справочники_Трек1.xlsx');

function rng(seed) { // mulberry32 — воспроизводимые случайные данные
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Организации: key — как организация названа в столбце «Организации» справочника.
// types: [вид отхода (как в справочнике), диапазон кол-ва за рабочий день, доля дней с записью]
const ORGS = [
  { name: 'Кафедра «Технология и переработка пищевых продуктов»', short: 'Кафедра ТПП', type: 'кафедра', building: 'Корпус 1', key: 'тпп',
    resp: ['tpp', 'tpp@atu.kz'], days: 'lab', bin: false,
    types: [['Упаковочные отходы', [0.4, 1.5], 1], ['Мясные кости', [1, 4], 0.9], ['Рыбные кости', [0.4, 2], 0.6]] },
  { name: 'Кафедра «Технология хлебопродуктов и перерабатывающих производств»', short: 'Кафедра ТХиПП', type: 'кафедра', building: 'Корпус 2', key: 'тхипп',
    resp: ['thipp', 'thipp@atu.kz'], days: 'lab', bin: false,
    types: [['Яичная скорлупа', [0.2, 0.8], 0.7], ['Сахароза', [0.1, 0.4], 0.5], ['ПЭТ-бутылка 1,0 л (растительное масло)', [0.05, 0.25], 0.5],
      ['Стеклобутылка', [0.3, 1.5], 0.4], ['Отходы образцов хлебобулочных изделий', [1, 3], 0.9], ['Отходы образцов кондитерских изделий', [0.5, 2], 0.7],
      ['Отходы фруктов и овощей', [1, 3], 0.7], ['Алюминиевые банки', [0.05, 0.3], 0.3]] },
  { name: 'Учебно-гостиничный комплекс ATU INN', short: 'ATU INN', type: 'гостиница', building: 'ул. Толе би, 100', key: 'atu inn',
    resp: ['inn', 'inn@atu.kz'], days: 'all', bin: true,
    types: [['Очистки овощей', [6, 12], 1], ['Обрезки мясопродуктов', [1.5, 3.5], 0.9], ['Пищевые отходы из зала', [8, 16], 1],
      ['Остатки нереализованной продукции', [3, 7], 1], ['Отработанное масло', [2, 4], 0.35], ['Картонная тара', [1.5, 4], 0.8]] },
  { name: 'Кофейня АТУ (ИП «Canella»)', short: 'Кофейня Canella', type: 'кофейня', building: 'Корпус 1, 1 этаж', key: 'кофейн',
    resp: ['canella', 'canella@atu.kz'], days: 'work6', bin: true,
    types: [['Кофейный жмых', [3, 6], 1], ['Картонная тара', [1, 2.5], 0.9], ['Остатки еды', [1, 3], 1]] },
  { name: 'Столовый комплекс корп. 1, 2 (ИП «Искандер»)', short: 'Столовая Искандер', type: 'столовая', building: 'Корпуса 1 и 2', key: 'столов',
    resp: ['iskander', 'iskander@atu.kz'], days: 'work6', bin: true,
    types: [['Очистки овощей', [14, 24], 1], ['Обрезки мясопродуктов', [3, 6], 1], ['Пищевые отходы из зала', [22, 38], 1],
      ['Остатки нереализованной продукции', [6, 13], 1], ['Отработанное масло', [3, 6], 0.4], ['Картонная тара', [3, 7], 0.9]] },
];

const ymOf = (d) => d.toISOString().slice(0, 7);
const iso = (d) => d.toISOString().slice(0, 10);
function addMonths(ym, k) { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); return ymOf(d); }

async function seed() {
  const R = rng(20261112);
  const rnd = (a, b) => Math.round((a + R() * (b - a)) * 10) / 10;
  db.exec(`DELETE FROM scale_devices; DELETE FROM status_history; DELETE FROM entries; DELETE FROM reports; DELETE FROM sessions;
    DELETE FROM waste_types; DELETE FROM users; DELETE FROM disposal_methods; DELETE FROM organizations; DELETE FROM sqlite_sequence;`);

  const pw = hashPassword('demo123');
  const uIns = db.prepare('INSERT INTO users (full_name, email, pass_hash, role, org_id) VALUES (?,?,?,?,?)');
  uIns.run('admin', 'admin@atu.kz', pw, 'admin', null);
  const reviewerId = Number(uIns.run('reviewer', 'reviewer@atu.kz', pw, 'reviewer', null).lastInsertRowid);
  uIns.run('director', 'director@atu.kz', pw, 'manager', null);

  const oIns = db.prepare('INSERT INTO organizations (name, short, type, building, match_key) VALUES (?,?,?,?,?)');
  const orgIds = ORGS.map((o) => Number(oIns.run(o.name, o.short, o.type, o.building, o.key).lastInsertRowid));

  // справочники организаторов: способы утилизации и виды отходов (с привязкой к организациям)
  const ref = await parseWorkbook(fs.readFileSync(REF_FILE));
  // в образцах таблиц АТУ есть ещё «Вывоз ТБО (мусорный бак)» — тоже полигон
  ref.methods.push({ code: 'TBO_BIN', name: 'Вывоз ТБО (мусорный бак)', co2PerT: null, rank: 5, note: 'Из образцов таблиц учёта АТУ', landfill: true });
  const stats = applyReference(ref);
  const M = Object.fromEntries(db.prepare('SELECT code, id FROM disposal_methods').all().map((m) => [m.code, m.id]));

  const today = new Date(Date.now() + 5 * 3600e3); const todayIso = iso(today); // Алматы, UTC+5
  const curYm = todayIso.slice(0, 7);
  const months = [-4, -3, -2, -1, 0].map((k) => addMonths(curYm, k));

  const rIns = db.prepare('INSERT INTO reports (org_id, period, status, submitted_at, reviewer_id, decided_at, last_comment) VALUES (?,?,?,?,?,?,?)');
  const eIns = db.prepare('INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, created_at) VALUES (?,?,?,?,?,?,?)');
  const hIns = db.prepare('INSERT INTO status_history (report_id, from_status, to_status, user_id, comment, at) VALUES (?,?,?,?,?,?)');

  db.exec('BEGIN');
  ORGS.forEach((o, oi) => {
    const orgId = orgIds[oi];
    const userId = Number(uIns.run(o.resp[0], o.resp[1], pw, 'resp', orgId).lastInsertRowid);
    // «как сейчас» в образцах: кафедры — «Вывоз ТБО», общепит — «Вывоз ТБО (мусорный бак)»; масло — спецорганизация
    db.prepare("UPDATE waste_types SET default_method_id=? WHERE org_id=? AND unit<>'л'").run(o.bin ? M.TBO_BIN : M.TBO, orgId);
    const types = o.types.map(([name, range, freq]) => {
      const w = db.prepare('SELECT id, name, default_method_id FROM waste_types WHERE org_id=? AND name=?').get(orgId, name);
      if (!w) throw new Error(`Вид «${name}» не найден в справочнике для ${o.short}`);
      return { ...w, range, freq };
    });

    months.forEach((ym, mi) => {
      const isCur = ym === curYm;
      const prevMonth = mi === months.length - 2;
      let status = isCur ? 'draft' : 'accepted';
      if (prevMonth && o.short === 'Кофейня Canella') status = 'submitted';
      const next = addMonths(ym, 1);
      const subAt = `${next}-03T09:${String(10 + mi).padStart(2, '0')}:00.000Z`;
      const decAt = `${next}-05T11:${String(20 + mi).padStart(2, '0')}:00.000Z`;
      const repId = Number(rIns.run(orgId, ym, status, status !== 'draft' ? subAt : null, status === 'accepted' ? reviewerId : null,
        status === 'accepted' ? decAt : null, null).lastInsertRowid);

      const month = +ym.slice(5, 7);
      const summer = month === 7 || month === 8;
      const dim = new Date(+ym.slice(0, 4), month, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const ds = `${ym}-${String(d).padStart(2, '0')}`;
        if (ds >= todayIso) break; // текущий месяц — до вчерашнего дня
        const wd = new Date(ds + 'T00:00:00').getDay();
        if (o.days === 'work6' && wd === 0) continue;
        if (o.days === 'lab' && !(summer ? [3] : [2, 4, 5]).includes(wd)) continue;
        let k = 1;
        if (o.type === 'столовая' || o.type === 'кофейня') k = summer ? 0.8 : 1;
        if (o.type === 'гостиница') k = summer ? 1.15 : 1;
        if (o.type === 'столовая' && wd === 1) k *= 1.2; // понедельник — пик
        for (const t of types) {
          if (R() > t.freq) continue;
          let kk = k;
          if (o.short === 'Столовая Искандер' && /из зала/.test(t.name)) kk *= 1 + 0.06 * mi; // рост отходов из зала
          if (o.short === 'ATU INN' && /нереализ/.test(t.name) && prevMonth) kk *= 1.75;     // аномалия (банкеты)
          const qty = Math.max(0.05, Math.round(rnd(t.range[0], t.range[1]) * kk * 10) / 10);
          let method = t.default_method_id;
          if (/масл/i.test(t.name) && R() < 0.2) method = o.bin ? M.TBO_BIN : M.TBO;           // часть масла всё ещё в ТБО
          if (/картон/i.test(t.name) && o.type === 'кофейня' && R() < 0.5) method = M.RECYCLE;
          if (/жмых/i.test(t.name) && R() < 0.2) method = M.COMPOST;
          if (/нереализ/i.test(t.name) && o.type === 'гостиница' && R() < 0.1) method = M.DONATE;
          eIns.run(repId, ds, t.id, qty, method, userId, `${ds}T${String(5 + Math.floor(R() * 8)).padStart(2, '0')}:15:00.000Z`);
        }
      }
      if (status !== 'draft') {
        if (o.short === 'Кафедра ТХиПП' && mi === 1) {
          hIns.run(repId, 'draft', 'submitted', userId, null, `${next}-02T10:00:00.000Z`);
          hIns.run(repId, 'submitted', 'in_review', reviewerId, null, `${next}-02T14:00:00.000Z`);
          hIns.run(repId, 'in_review', 'returned', reviewerId, 'Нет данных за 12 и 19 число — проверьте журнал лабораторных занятий', `${next}-02T14:05:00.000Z`);
          hIns.run(repId, 'returned', 'submitted', userId, 'Дополнено по журналу', subAt);
        } else hIns.run(repId, 'draft', 'submitted', userId, null, subAt);
        if (status === 'accepted') {
          hIns.run(repId, 'submitted', 'in_review', reviewerId, null, decAt.replace('11:', '10:'));
          hIns.run(repId, 'in_review', 'accepted', reviewerId, null, decAt);
        }
      }
    });
  });
  // по одному электронному весу на организацию; демо-токены `demo-scale-<id>` (в БД — только хэш)
  const devIns = db.prepare('INSERT INTO scale_devices (org_id, name, token_hash, token_hint) VALUES (?,?,?,?)');
  for (const o of db.prepare('SELECT id, short FROM organizations').all()) {
    const token = `demo-scale-${o.id}`;
    devIns.run(o.id, `Весы · ${o.short}`, crypto.createHash('sha256').update(token).digest('hex'), token);
  }
  db.exec('COMMIT');
  const c = db.prepare('SELECT COUNT(*) c FROM entries').get().c;
  console.log(`Справочник: способов ${stats.methodsAdded}, видов отходов ${stats.typesAdded}. Демо: ${ORGS.length} организаций, ${c} записей, ${months[0]} — ${months[4]}. Пароль демо-пользователей: demo123`);
}

module.exports = { seed };
if (require.main === module) seed().catch((e) => { console.error(e); process.exit(1); });
