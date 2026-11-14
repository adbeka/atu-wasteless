// Цели сокращения отходов и рейтинг подразделений.
// Честное сравнение организаций разного размера: считаем не килограммы, а изменение к своей же базе
// (кг на активный день за 3 предыдущих месяца), долю «мимо полигона», регулярность учёта и своевременность отчёта.
const { db, nowIso } = require('./db');
const A = require('./analytics');

// таблица org_goals — в db.js: reduce_pct (снизить кг/день к базе, %), diverted_pct (доля мимо полигона, %)
const DEFAULT = { reduce_pct: 10, diverted_pct: 30 };

const ym = (d) => d.slice(0, 7);
const monthStart = (p) => `${p}-01`;
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
const shiftMonth = (p, k) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const r1 = (x) => Math.round(x * 10) / 10;
const LOW_FREQ = /кафедр|лаборатор/i; // подразделения, которые взвешивают не каждый день

async function goalOf(orgId) { return { ...DEFAULT, ...((await db.prepare('SELECT reduce_pct, diverted_pct FROM org_goals WHERE org_id=?').get(orgId)) || {}) }; }
async function setGoal(orgId, b, userId) {
  const g = { ...(await goalOf(orgId)) };
  if (b.reduce_pct != null) g.reduce_pct = clamp(Number(b.reduce_pct) || 0, 0, 90);
  if (b.diverted_pct != null) g.diverted_pct = clamp(Number(b.diverted_pct) || 0, 0, 100);
  await db.prepare(`INSERT INTO org_goals (org_id, reduce_pct, diverted_pct, updated_by, updated_at) VALUES (?,?,?,?,?)
    ON CONFLICT(org_id) DO UPDATE SET reduce_pct=excluded.reduce_pct, diverted_pct=excluded.diverted_pct, updated_by=excluded.updated_by, updated_at=excluded.updated_at`)
    .run(orgId, g.reduce_pct, g.diverted_pct, userId || null, nowIso());
  return g;
}

function perDay(rows) {
  const days = new Set(rows.map((r) => r.date)).size;
  const kg = rows.reduce((a, r) => a + r.kg, 0);
  return { kg, days, perDay: days ? kg / days : 0 };
}

async function rating(tenantId, period = ym(A.today())) {
  const t = A.today();
  const from = monthStart(period), to = period === ym(t) ? t : monthEnd(period);
  const elapsed = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const bFrom = monthStart(shiftMonth(period, -3)), bTo = monthEnd(shiftMonth(period, -1));
  const prevP = shiftMonth(period, -1);
  const deadline = `${period}-05`; // отчёт за прошлый месяц — до 5 числа
  const orgs = await db.prepare('SELECT * FROM organizations WHERE active=1 AND tenant_id=? ORDER BY id').all(+tenantId);
  const rows = [];
  for (const o of orgs) {
    const curRows = await A.registryRows({ from, to, orgId: o.id, statuses: A.ALL_ST });
    const cur = perDay(curRows);
    const base = perDay(await A.registryRows({ from: bFrom, to: bTo, orgId: o.id, statuses: A.ALL_ST }));
    const g = await goalOf(o.id);
    const changePct = base.perDay && cur.days ? r1((cur.perDay - base.perDay) / base.perDay * 100) : null;
    const diverted = cur.kg ? r1(curRows.filter((r) => r.is_recycling).reduce((a, r) => a + r.kg, 0) / cur.kg * 100) : 0;
    const expectedDays = Math.max(1, Math.round(elapsed * (LOW_FREQ.test(o.type) ? 0.15 : 0.7)));
    const regularity = clamp(cur.days / expectedDays, 0, 1);
    const prevRep = await db.prepare('SELECT status, submitted_at FROM reports WHERE org_id=? AND period=?').get(o.id, prevP);
    const onTime = !!(prevRep && ['submitted', 'in_review', 'accepted'].includes(prevRep.status) && prevRep.submitted_at && prevRep.submitted_at.slice(0, 10) <= deadline);
    // баллы: снижение к базе 40 · мимо полигона 30 · регулярность 20 · отчёт вовремя 10
    const sRed = changePct == null ? 0.5 : clamp(0.5 - (changePct / (g.reduce_pct || 10)) * 0.5, 0, 1);
    const sDiv = clamp(diverted / Math.max(1, g.diverted_pct), 0, 1);
    const score = Math.round(40 * sRed + 30 * sDiv + 20 * regularity + 10 * (onTime ? 1 : 0));
    const target = base.perDay ? base.perDay * (1 - g.reduce_pct / 100) : null;
    const savedKg = changePct != null && changePct < 0 ? r1((base.perDay - cur.perDay) * cur.days) : 0;
    const badges = [];
    if (changePct != null && changePct <= -g.reduce_pct) badges.push({ k: 'goal', level: 'good', text: 'Цель по снижению выполнена' });
    if (diverted >= g.diverted_pct) badges.push({ k: 'divert', level: 'good', text: `Мимо полигона ≥ ${g.diverted_pct}%` });
    if (regularity >= 1) badges.push({ k: 'regular', level: 'good', text: 'Регулярный учёт' });
    if (onTime) badges.push({ k: 'ontime', level: 'good', text: 'Отчёт сдан вовремя' });
    if (changePct != null && changePct > 10) badges.push({ k: 'growth', level: 'warn', text: `Рост на ${changePct}%` });
    if (!cur.days) badges.push({ k: 'nodata', level: 'warn', text: 'Нет записей за месяц' });
    rows.push({
      org_id: o.id, org: o.name, short: o.short, type: o.type, goal: g, score,
      kgPerDay: r1(cur.perDay), basePerDay: r1(base.perDay), targetPerDay: target == null ? null : r1(target),
      changePct, diverted, activeDays: cur.days, expectedDays, regularity: Math.round(regularity * 100), onTime, kg: r1(cur.kg), savedKg,
      // прогресс к цели: 0% — на уровне базы, 100% — цель достигнута
      progress: changePct == null ? null : Math.round(clamp(-changePct / (g.reduce_pct || 10), -1, 1.5) * 100),
      badges,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  rows.forEach((r, i) => { r.place = i + 1; });
  return { period, label: A.monthFull(period), from, to, baseline: { from: bFrom, to: bTo }, rows };
}

module.exports = { rating, goalOf, setGoal, DEFAULT };
