// Начальные данные платформы:
//  1) общие справочники — способы утилизации и коэффициенты CO₂ (reference/Справочники_Трек1.xlsx, DEFRA 2024) и продукты;
//  2) демо-компания (tenant kind='demo') — 5 организаций АТУ с синтетическими взвешиваниями за 4 месяца + текущий.
// В демо входят только кнопкой «Посмотреть демо» (только чтение); пароли демо-пользователей случайные.
// Запуск: npm run seed (создаёт недостающее, существующие данные не трогает; --reset-demo — пересоздать демо).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, init, hashPassword, nowIso } = require('./db');
const { parseWorkbook, applyReference } = require('./reference');
const PROD = require('./products');

const REF_FILE = path.join(__dirname, 'reference', 'Справочники_Трек1.xlsx');

function rng(seed) { // mulberry32 — воспроизводимые случайные данные
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Организации: key — как организация названа в столбце «Организации» справочника.
// types: [вид отхода (как в справочнике), диапазон кол-ва за рабочий день, доля дней с записью]
const ORGS = [
  { name: 'Кафедра «Технология и переработка пищевых продуктов»', short: 'Кафедра ТПП', type: 'кафедра', building: 'Корпус 1', key: 'тпп',
    resp: ['tpp', 'demo.tpp@wasteless.demo'], days: 'lab', bin: false,
    types: [['Упаковочные отходы', [0.4, 1.5], 1], ['Мясные кости', [1, 4], 0.9], ['Рыбные кости', [0.4, 2], 0.6]] },
  { name: 'Кафедра «Технология хлебопродуктов и перерабатывающих производств»', short: 'Кафедра ТХиПП', type: 'кафедра', building: 'Корпус 2', key: 'тхипп',
    resp: ['thipp', 'demo.thipp@wasteless.demo'], days: 'lab', bin: false,
    types: [['Яичная скорлупа', [0.2, 0.8], 0.7], ['Сахароза', [0.1, 0.4], 0.5], ['ПЭТ-бутылка 1,0 л (растительное масло)', [0.05, 0.25], 0.5],
      ['Стеклобутылка', [0.3, 1.5], 0.4], ['Отходы образцов хлебобулочных изделий', [1, 3], 0.9], ['Отходы образцов кондитерских изделий', [0.5, 2], 0.7],
      ['Отходы фруктов и овощей', [1, 3], 0.7], ['Алюминиевые банки', [0.05, 0.3], 0.3]] },
  { name: 'Учебно-гостиничный комплекс ATU INN', short: 'ATU INN', type: 'гостиница', building: 'ул. Толе би, 100', key: 'atu inn',
    resp: ['inn', 'demo.inn@wasteless.demo'], days: 'all', bin: true,
    types: [['Очистки овощей', [6, 12], 1], ['Обрезки мясопродуктов', [1.5, 3.5], 0.9], ['Пищевые отходы из зала', [8, 16], 1],
      ['Остатки нереализованной продукции', [3, 7], 1], ['Отработанное масло', [2, 4], 0.35], ['Картонная тара', [1.5, 4], 0.8]] },
  { name: 'Кофейня АТУ (ИП «Canella»)', short: 'Кофейня Canella', type: 'кофейня', building: 'Корпус 1, 1 этаж', key: 'кофейн',
    resp: ['canella', 'demo.canella@wasteless.demo'], days: 'work6', bin: true,
    types: [['Кофейный жмых', [3, 6], 1], ['Картонная тара', [1, 2.5], 0.9], ['Остатки еды', [1, 3], 1]] },
  { name: 'Столовый комплекс корп. 1, 2 (ИП «Искандер»)', short: 'Столовая Искандер', type: 'столовая', building: 'Корпуса 1 и 2', key: 'столов',
    resp: ['iskander', 'demo.iskander@wasteless.demo'], days: 'work6', bin: true,
    types: [['Очистки овощей', [14, 24], 1], ['Обрезки мясопродуктов', [3, 6], 1], ['Пищевые отходы из зала', [22, 38], 1],
      ['Остатки нереализованной продукции', [6, 13], 1], ['Отработанное масло', [3, 6], 0.4], ['Картонная тара', [3, 7], 0.9]] },
];

const ymOf = (d) => d.toISOString().slice(0, 7);
const iso = (d) => d.toISOString().slice(0, 10);
function addMonths(ym, k) { const d = new Date(ym + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); return ymOf(d); }

async function loadRef() {
  const ref = await parseWorkbook(fs.readFileSync(REF_FILE));
  // в образцах таблиц АТУ есть ещё «Вывоз ТБО (мусорный бак)» — тоже полигон
  ref.methods.push({ code: 'TBO_BIN', name: 'Вывоз ТБО (мусорный бак)', co2PerT: null, rank: 5, note: 'Бытовой контейнер', landfill: true });
  return ref;
}
// общие справочники платформы: способы утилизации (DEFRA 2024) и продукты
async function seedPlatform() {
  await init();
  let methods = 0;
  if (!(await db.prepare('SELECT COUNT(*) c FROM disposal_methods').get()).c) {
    const ref = await loadRef();
    methods = (await applyReference({ methods: ref.methods, types: [] }, { tenantId: 0, withMethods: true })).methodsAdded;
  }
  const products = await PROD.seedIfEmpty();
  return { methods, products };
}

const DEMO_NAME = 'Демо: университет АТУ';
async function demoTenant() { return db.prepare("SELECT * FROM tenants WHERE kind='demo' ORDER BY id LIMIT 1").get(); }

async function seed({ resetDemo = false } = {}) {
  await seedPlatform();
  let tn = await demoTenant();
  if (tn && resetDemo) { await deleteTenant(tn.id); tn = null; }
  if (tn) return tn.id;
  return db.tx(() => seedDemo());
}

// удалить все данные компании (используется для пересоздания демо)
async function deleteTenant(tid) {
  await db.tx(async () => {
    const org = 'SELECT id FROM organizations WHERE tenant_id=?';
    const usr = 'SELECT id FROM users WHERE tenant_id=?';
    await db.prepare(`DELETE FROM status_history WHERE report_id IN (SELECT id FROM reports WHERE org_id IN (${org}))`).run(tid);
    await db.prepare(`DELETE FROM entries WHERE report_id IN (SELECT id FROM reports WHERE org_id IN (${org}))`).run(tid);
    await db.prepare(`DELETE FROM reports WHERE org_id IN (${org})`).run(tid);
    for (const t of ['production', 'org_goals', 'scale_devices']) await db.prepare(`DELETE FROM ${t} WHERE org_id IN (${org})`).run(tid);
    await db.prepare(`DELETE FROM sessions WHERE user_id IN (${usr})`).run(tid);
    await db.prepare(`DELETE FROM tg_links WHERE user_id IN (${usr})`).run(tid);
    await db.prepare('DELETE FROM invites WHERE tenant_id=?').run(tid);
    await db.prepare(`UPDATE waste_types SET created_by=NULL WHERE created_by IN (${usr})`).run(tid);
    await db.prepare(`DELETE FROM waste_types WHERE org_id IN (${org})`).run(tid);
    await db.prepare('DELETE FROM users WHERE tenant_id=?').run(tid);
    await db.prepare('DELETE FROM organizations WHERE tenant_id=?').run(tid);
    await db.prepare('DELETE FROM settings WHERE tenant_id=?').run(tid);
    await db.prepare('DELETE FROM tenants WHERE id=?').run(tid);
  });
}

async function seedDemo() {
  const R = rng(20261112);
  const rnd = (a, b) => Math.round((a + R() * (b - a)) * 10) / 10;
  const tid = Number((await db.prepare("INSERT INTO tenants (name, kind, industry, created_at) VALUES (?, 'demo', 'university', ?)").run(DEMO_NAME, nowIso())).lastInsertRowid);
  await db.prepare('INSERT INTO settings (tenant_id, key, value) VALUES (?,?,?)').run(tid, 'company', 'АО «Алматинский технологический университет» (демо)');

  const pw = hashPassword(crypto.randomBytes(24).toString('hex')); // по паролю в демо не войти
  const uIns = db.prepare('INSERT INTO users (tenant_id, full_name, email, pass_hash, role, org_id, created_at) VALUES (?,?,?,?,?,?,?)');
  await uIns.run(tid, 'admin', 'demo.admin@wasteless.demo', pw, 'admin', null, nowIso());
  const reviewerId = Number((await uIns.run(tid, 'reviewer', 'demo.reviewer@wasteless.demo', pw, 'reviewer', null, nowIso())).lastInsertRowid);
  await uIns.run(tid, 'director', 'demo.director@wasteless.demo', pw, 'manager', null, nowIso());

  const oIns = db.prepare('INSERT INTO organizations (tenant_id, name, short, type, building, match_key) VALUES (?,?,?,?,?,?)');
  const orgIds = [];
  for (const o of ORGS) orgIds.push(Number((await oIns.run(tid, o.name, o.short, o.type, o.building, o.key)).lastInsertRowid));

  // виды отходов из справочника организаторов (с привязкой к организациям по столбцу «Организации»)
  const ref = await loadRef();
  const stats = await applyReference({ methods: [], types: ref.types }, { tenantId: tid });
  const M = Object.fromEntries((await db.prepare('SELECT code, id FROM disposal_methods').all()).map((m) => [m.code, m.id]));

  const today = new Date(Date.now() + 5 * 3600e3); const todayIso = iso(today); // Алматы, UTC+5
  const curYm = todayIso.slice(0, 7);
  const months = [-4, -3, -2, -1, 0].map((k) => addMonths(curYm, k));

  const rIns = db.prepare('INSERT INTO reports (org_id, period, status, submitted_at, reviewer_id, decided_at, last_comment) VALUES (?,?,?,?,?,?,?)');
  const eIns = db.prepare('INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, created_at) VALUES (?,?,?,?,?,?,?)');
  const hIns = db.prepare('INSERT INTO status_history (report_id, from_status, to_status, user_id, comment, at) VALUES (?,?,?,?,?,?)');

  for (let oi = 0; oi < ORGS.length; oi++) {
    const o = ORGS[oi];
    const orgId = orgIds[oi];
    const userId = Number((await uIns.run(tid, o.resp[0], o.resp[1], pw, 'resp', orgId, nowIso())).lastInsertRowid);
    // «как сейчас» в образцах: кафедры — «Вывоз ТБО», общепит — «Вывоз ТБО (мусорный бак)»; масло — спецорганизация
    await db.prepare("UPDATE waste_types SET default_method_id=? WHERE org_id=? AND unit<>'л'").run(o.bin ? M.TBO_BIN : M.TBO, orgId);
    const types = [];
    for (const [name, range, freq] of o.types) {
      const w = await db.prepare('SELECT id, name, default_method_id FROM waste_types WHERE org_id=? AND name=?').get(orgId, name);
      if (!w) throw new Error(`Вид «${name}» не найден в справочнике для ${o.short}`);
      types.push({ ...w, range, freq });
    }

    for (let mi = 0; mi < months.length; mi++) {
      const ym = months[mi];
      const isCur = ym === curYm;
      const prevMonth = mi === months.length - 2;
      let status = isCur ? 'draft' : 'accepted';
      if (prevMonth && o.short === 'Кофейня Canella') status = 'submitted';
      const next = addMonths(ym, 1);
      const subAt = `${next}-03T09:${String(10 + mi).padStart(2, '0')}:00.000Z`;
      const decAt = `${next}-05T11:${String(20 + mi).padStart(2, '0')}:00.000Z`;
      const repId = Number((await rIns.run(orgId, ym, status, status !== 'draft' ? subAt : null, status === 'accepted' ? reviewerId : null,
        status === 'accepted' ? decAt : null, null)).lastInsertRowid);

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
          await eIns.run(repId, ds, t.id, qty, method, userId, `${ds}T${String(5 + Math.floor(R() * 8)).padStart(2, '0')}:15:00.000Z`);
        }
      }
      if (status !== 'draft') {
        if (o.short === 'Кафедра ТХиПП' && mi === 1) {
          await hIns.run(repId, 'draft', 'submitted', userId, null, `${next}-02T10:00:00.000Z`);
          await hIns.run(repId, 'submitted', 'in_review', reviewerId, null, `${next}-02T14:00:00.000Z`);
          await hIns.run(repId, 'in_review', 'returned', reviewerId, 'Нет данных за 12 и 19 число — проверьте журнал лабораторных занятий', `${next}-02T14:05:00.000Z`);
          await hIns.run(repId, 'returned', 'submitted', userId, 'Дополнено по журналу', subAt);
        } else await hIns.run(repId, 'draft', 'submitted', userId, null, subAt);
        if (status === 'accepted') {
          await hIns.run(repId, 'submitted', 'in_review', reviewerId, null, decAt.replace('11:', '10:'));
          await hIns.run(repId, 'in_review', 'accepted', reviewerId, null, decAt);
        }
      }
    }
  }
  // по одному электронному весу на организацию; демо-токены `demo-scale-<id>` (в БД — только хэш)
  const devIns = db.prepare('INSERT INTO scale_devices (org_id, name, token_hash, token_hint) VALUES (?,?,?,?)');
  for (let oi = 0; oi < ORGS.length; oi++) {
    const token = `demo-scale-${orgIds[oi]}`;
    await devIns.run(orgIds[oi], `Весы · ${ORGS[oi].short}`, crypto.createHash('sha256').update(token).digest('hex'), token);
  }
  const c = (await db.prepare('SELECT COUNT(*) c FROM entries e JOIN reports r ON r.id=e.report_id JOIN organizations o ON o.id=r.org_id WHERE o.tenant_id=?').get(tid)).c;
  console.log(`Демо-компания #${tid}: видов отходов ${stats.typesAdded}, ${ORGS.length} организаций, ${c} записей, ${months[0]} — ${months[4]}.`);
  return tid;
}

module.exports = { seed, seedPlatform, demoTenant, deleteTenant };
if (require.main === module) seed({ resetDemo: process.argv.includes('--reset-demo') }).then(() => db.end()).catch((e) => { console.error(e); process.exit(1); });
