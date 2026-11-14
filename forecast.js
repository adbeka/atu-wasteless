// Прогноз «сколько готовить завтра».
// Повар в конце дня вносит по блюдам: сколько приготовили и сколько осталось нереализованным.
// Спрос = приготовлено − остаток. Прогноз на дату = взвешенное среднее спроса в тот же день недели
// за 6 предыдущих недель (свежие недели весят больше) + страховой запас 5%.
// Рекомендация сравнивается с тем, сколько обычно готовят, — разница и есть предотвращённые отходы (кг, ₸, CO₂).
const { db, nowIso } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cooked_kg REAL NOT NULL CHECK (cooked_kg >= 0),
  leftover_kg REAL,                     -- осталось нереализованным к закрытию (NULL — ещё не внесено)
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, date, product_id)
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_production_org_date ON production(org_id, date)');

const SAFETY = 0.05;          // страховой запас, чтобы не оставить людей без обеда
const WEEKS = 6;
const LANDFILL_CO2 = 0.70021; // кг CO₂e на кг пищевых отходов на полигоне (DEFRA 2024)
const r1 = (x) => Math.round(x * 10) / 10;
const addDays = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const weekday = (d) => new Date(d + 'T00:00:00Z').getUTCDay();

function saveDay(orgId, userId, date, items) {
  const up = db.prepare(`INSERT INTO production (org_id, date, product_id, cooked_kg, leftover_kg, user_id, created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(org_id, date, product_id) DO UPDATE SET cooked_kg=excluded.cooked_kg, leftover_kg=excluded.leftover_kg, user_id=excluded.user_id`);
  // сначала проверяем все строки, потом пишем — чтобы не сохранить итог дня наполовину
  for (const it of items) {
    const c = Number(String(it.cooked_kg ?? '').replace(',', '.')); const l = it.leftover_kg === '' || it.leftover_kg == null ? null : Number(String(it.leftover_kg).replace(',', '.'));
    if (!(c >= 0) || c > 2000) throw new Error('Проверьте «приготовлено»: нужно число от 0 до 2000 кг');
    if (l != null && !(l >= 0 && l <= c)) throw new Error('Остаток не может быть больше, чем приготовлено');
  }
  let n = 0;
  for (const it of items) {
    const cooked = Number(String(it.cooked_kg ?? '').replace(',', '.'));
    const left = it.leftover_kg === '' || it.leftover_kg == null ? null : Number(String(it.leftover_kg).replace(',', '.'));
    if (!(cooked >= 0) || !db.prepare('SELECT id FROM products WHERE id=?').get(+it.product_id)) continue;
    if (left != null && !(left >= 0 && left <= cooked)) throw new Error('Остаток не может быть больше, чем приготовлено');
    if (!cooked && left == null) { db.prepare('DELETE FROM production WHERE org_id=? AND date=? AND product_id=?').run(orgId, date, +it.product_id); continue; }
    up.run(orgId, date, +it.product_id, cooked, left, userId, nowIso()); n++;
  }
  return n;
}

const dayRows = (orgId, date) => db.prepare(`SELECT p.product_id, p.cooked_kg, p.leftover_kg, pr.name, pr.name_kz, pr.price_kzt_kg
  FROM production p JOIN products pr ON pr.id = p.product_id WHERE p.org_id=? AND p.date=? ORDER BY pr.name`).all(orgId, date);

// прогноз на дату для организации
function forecast(orgId, date) {
  const from = addDays(date, -7 * WEEKS), to = addDays(date, -1);
  const hist = db.prepare(`SELECT p.date, p.product_id, p.cooked_kg, p.leftover_kg, pr.name, pr.name_kz, pr.price_kzt_kg
    FROM production p JOIN products pr ON pr.id = p.product_id
    WHERE p.org_id=? AND p.date BETWEEN ? AND ? AND p.leftover_kg IS NOT NULL`).all(orgId, from, to);
  const wd = weekday(date);
  const byProd = new Map();
  for (const h of hist) { if (!byProd.has(h.product_id)) byProd.set(h.product_id, []); byProd.get(h.product_id).push(h); }
  const items = [];
  // в этот день недели организация обычно не работает (нет истории) — прогноз не строим
  const daysThisWd = new Set(hist.filter((r) => weekday(r.date) === wd).map((r) => r.date)).size;
  const closed = hist.length > 0 && daysThisWd < 2;
  for (const [pid, rows] of byProd) {
    if (closed) break;
    const sample = rows.filter((r) => weekday(r.date) === wd);
    const basis = 'weekday';
    if (sample.length < 2) continue; // блюдо в этот день недели обычно не готовят
    let wsum = 0, dem = 0, cooked = 0, left = 0;
    for (const r of sample) {
      const age = Math.round((new Date(date) - new Date(r.date)) / 864e5);
      const w = 1 / (1 + age / 14); // свежие данные важнее
      wsum += w; dem += w * (r.cooked_kg - r.leftover_kg); cooked += w * r.cooked_kg; left += w * r.leftover_kg;
    }
    dem /= wsum; cooked /= wsum; left /= wsum;
    const rec = dem * (1 + SAFETY);
    const save = Math.max(0, cooked - rec);
    const p = rows[0];
    items.push({
      product_id: pid, name: p.name, name_kz: p.name_kz, price_kzt_kg: p.price_kzt_kg,
      rec_kg: r1(rec), usual_kg: r1(cooked), demand_kg: r1(dem), leftover_kg: r1(left), leftover_pct: cooked ? Math.round(left / cooked * 100) : 0,
      save_kg: r1(save), save_kzt: Math.round(save * (p.price_kzt_kg || 0)), n: sample.length, basis,
      confidence: sample.length >= 4 ? 'high' : sample.length >= 3 ? 'medium' : 'low',
    });
  }
  items.sort((a, b) => b.save_kg - a.save_kg || b.usual_kg - a.usual_kg);
  const sum = (k) => r1(items.reduce((a, x) => a + x[k], 0));
  return {
    org_id: orgId, date, weekday: WD[wd], items, closed, historyDays: new Set(hist.map((r) => r.date)).size, safetyPct: SAFETY * 100, weeks: WEEKS,
    totals: { rec_kg: sum('rec_kg'), usual_kg: sum('usual_kg'), save_kg: sum('save_kg'), save_kzt: items.reduce((a, x) => a + x.save_kzt, 0), save_co2: r1(sum('save_kg') * LANDFILL_CO2) },
  };
}

// насколько точны были прогнозы и сколько реально сэкономили, если готовили по рекомендации (последние 30 дней)
function track(orgId, toDate) {
  const days = db.prepare('SELECT DISTINCT date FROM production WHERE org_id=? AND date BETWEEN ? AND ? AND leftover_kg IS NOT NULL ORDER BY date')
    .all(orgId, addDays(toDate, -30), toDate).map((r) => r.date);
  let cooked = 0, left = 0;
  for (const d of days) for (const r of dayRows(orgId, d)) { cooked += r.cooked_kg; left += r.leftover_kg ?? 0; }
  return { days: days.length, cooked_kg: r1(cooked), leftover_kg: r1(left), leftover_pct: cooked ? r1(left / cooked * 100) : null };
}

// демо-история (6 недель) для столовой и кофейни, если таблица пустая: без неё прогноз нечем показать
function seedDemo(todayIso) {
  if (db.prepare('SELECT COUNT(*) n FROM production').get().n) return 0;
  const org = (re) => db.prepare('SELECT id, type FROM organizations WHERE active=1').all().find((o) => re.test(o.type));
  const pid = (name) => db.prepare('SELECT id FROM products WHERE name=?').get(name)?.id;
  const user = (orgId) => db.prepare("SELECT id FROM users WHERE org_id=? AND role='resp' LIMIT 1").get(orgId)?.id || null;
  const plans = [
    [org(/столов/i), [['Рис', 28, 0.16], ['Суп', 35, 0.12], ['Мясное блюдо', 22, 0.09], ['Картофельное пюре', 18, 0.14], ['Салат', 9, 0.2], ['Хлеб', 12, 0.18], ['Выпечка', 8, 0.15]], [1, 2, 3, 4, 5, 6]],
    [org(/кофейн/i), [['Выпечка', 6, 0.22], ['Кондитерские изделия', 4, 0.18], ['Салат', 2.5, 0.2]], [1, 2, 3, 4, 5, 6]],
  ];
  // спрос по дням недели: в пятницу и субботу студентов меньше, а готовят «как обычно» — отсюда остатки
  const DEMAND = { 1: 1, 2: 1.04, 3: 1.02, 4: 0.98, 5: 0.82, 6: 0.55 };
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let n = 0;
  const ins = db.prepare('INSERT OR IGNORE INTO production (org_id, date, product_id, cooked_kg, leftover_kg, user_id, created_at) VALUES (?,?,?,?,?,?,?)');
  for (const [o, prods, days] of plans) {
    if (!o) continue;
    const u = user(o.id);
    for (let k = 42; k >= 1; k--) {
      const d = addDays(todayIso, -k); const wd = weekday(d);
      if (!days.includes(wd)) continue;
      for (const [name, base, rate] of prods) {
        const id = pid(name); if (!id) continue;
        const cooked = base * (wd === 6 ? 0.8 : 1) * (0.95 + rnd() * 0.1);           // готовят почти одинаково каждый день
        const demand = base * DEMAND[wd] * (1 - rate * 0.6) * (0.92 + rnd() * 0.16);  // а спрос плавает
        const left = Math.max(0, Math.min(cooked, cooked - demand));
        ins.run(o.id, d, id, r1(cooked), r1(left), u, nowIso()); n++;
      }
    }
  }
  return n;
}

module.exports = { forecast, saveDay, dayRows, track, seedDemo, addDays, SAFETY };
