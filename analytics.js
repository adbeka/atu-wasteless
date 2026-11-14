// Аналитика и движок «Автовыводы»: правила, которые превращают записи в выводы и рекомендации.
const { db } = require('./db');

// Коэффициент для отходов, отправленных на переработку/компост (вместо полигона),
// DESNZ/DEFRA GHG Conversion Factors 2023, Waste disposal: closed-loop / composting ≈ 8.9 кг CO2e/т
// коэффициенты CO₂ берутся из справочника (waste_types.co2_factor, disposal_methods.co2_factor) — DEFRA 2024
const ANOMALY_PCT = Number(process.env.ANOMALY_PCT || 30); // рост > N% к среднему = отклонение
const UNSOLD_PRICE_KZT = Number(process.env.UNSOLD_PRICE_KZT || 1500); // допущение: себестоимость 1 кг нереализованной продукции

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];

// «сегодня» по Алматы (UTC+5), чтобы запись в 00:00–05:00 не считалась «датой в будущем»
const today = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const minPeriod = () => { const d = new Date(Date.now() + 5 * 3600e3); d.setUTCMonth(d.getUTCMonth() - 12); return d.toISOString().slice(0, 7); };
const monthLabel = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(2, 4)}`;
const monthFull = (ym) => `${MONTHS_FULL[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const daysInMonth = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
const r1 = (x) => Math.round(x * 10) / 10;
const fmt = (x, d = 0) => Number(x).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const kgOrT = (kg) => (kg >= 1000 ? `${fmt(kg / 1000, 2)} т` : `${fmt(kg, 1)} кг`);
const pct = (a, b) => (b ? ((a - b) / b) * 100 : null);

function monthsBetween(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ty = +to.slice(0, 4), tm = +to.slice(5, 7);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// Период: month (2026-10), quarter (2026-Q3), year (2026) -> {from, to, label}
function periodRange(kind, value) {
  if (kind === 'month') {
    const ym = value; return { from: `${ym}-01`, to: `${ym}-${daysInMonth(ym)}`, label: monthFull(ym), months: [ym] };
  }
  if (kind === 'quarter') {
    const [y, q] = value.split('-Q').map(Number);
    const m1 = (q - 1) * 3 + 1; const ms = [0, 1, 2].map((i) => `${y}-${String(m1 + i).padStart(2, '0')}`);
    return { from: `${ms[0]}-01`, to: `${ms[2]}-${daysInMonth(ms[2])}`, label: `${q} квартал ${y}`, months: ms };
  }
  const y = +value; const ms = monthsBetween(`${y}-01`, `${y}-12`);
  return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y} год`, months: ms };
}

// Записи единого реестра (по умолчанию только принятые отчёты). tenantId — изоляция данных компании.
async function registryRows({ tenantId, reportId, from, to, orgId, typeId, typeName, methodId, statuses = ['accepted'] } = {}) {
  const where = [`r.status IN (${statuses.map(() => '?').join(',')})`];
  const p = [...statuses];
  if (tenantId) { where.push('o.tenant_id = ?'); p.push(+tenantId); }
  if (reportId) { where.push('r.id = ?'); p.push(+reportId); }
  if (from) { where.push('e.date >= ?'); p.push(from); }
  if (to) { where.push('e.date <= ?'); p.push(to); }
  if (orgId) { where.push('r.org_id = ?'); p.push(+orgId); }
  if (typeId) { where.push('e.waste_type_id = ?'); p.push(+typeId); }
  if (typeName) { where.push('w.name = ?'); p.push(String(typeName)); }
  if (methodId) { where.push('e.method_id = ?'); p.push(+methodId); }
  return (await db.prepare(`
    SELECT e.id, e.date, e.qty, e.photo, e.created_at, e.source, r.id report_id, r.period, r.org_id,
      o.name org_name, o.short org_short, o.type org_type,
      w.id type_id, w.name type_name, w.unit, w.kg_per_unit, w.recyclable, w.co2_factor, w.category,
      m.id method_id, m.name method_name, m.is_recycling, m.co2_factor method_co2, m.rank method_rank,
      rm.name rec_name, rm.co2_factor rec_co2, u.full_name user_name, e.product_id, pr.name product_name, pr.price_kzt_kg
    FROM entries e JOIN reports r ON r.id = e.report_id
    LEFT JOIN products pr ON pr.id = e.product_id
    JOIN organizations o ON o.id = r.org_id
    JOIN waste_types w ON w.id = e.waste_type_id
    JOIN disposal_methods m ON m.id = e.method_id
    LEFT JOIN disposal_methods rm ON rm.id = w.recommended_method_id
    JOIN users u ON u.id = e.user_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.date DESC, e.id DESC`).all(...p)).map(enrich);
}

function enrich(row) {
  const kg = row.qty * row.kg_per_unit;
  // Формула справочника: CO₂ = масса × коэффициент. Полигон (ТБО) — коэффициент вида отхода; иначе — коэффициент способа
  // (нет коэффициента, напр. корм животным/фудшеринг — 0). Экономия = масса × (коэф. ТБО − коэф. рекомендуемого способа).
  const co2 = kg * (row.is_recycling ? (row.method_co2 ?? 0) : row.co2_factor);
  const co2Potential = row.recyclable && !row.is_recycling && row.rec_name ? Math.max(0, kg * (row.co2_factor - (row.rec_co2 ?? 0))) : 0;
  return { ...row, kg, co2, co2Potential };
}

function sum(rows, f = (r) => r.kg) { return rows.reduce((a, r) => a + f(r), 0); }
function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}

// Дни, за которые «считается» месяц (текущий месяц — неполный)
function coveredDays(ym) {
  const t = today();
  if (t.slice(0, 7) === ym) return +t.slice(8, 10);
  return daysInMonth(ym);
}

// ---------- Dashboard ----------
async function dashboard({ tenantId, from, to, orgId, anomalyFrom, statuses }) {
  const rows = await registryRows({ tenantId, from, to, orgId, statuses });
  const months = monthsBetween(from.slice(0, 7), to.slice(0, 7));
  const orgs = (await db.prepare('SELECT id, short, name FROM organizations WHERE active=1 AND tenant_id=? ORDER BY id').all(+tenantId))
    .filter((o) => !orgId || o.id === +orgId);

  const byMonth = groupBy(rows, (r) => r.date.slice(0, 7));
  const monthly = months.map((ym) => {
    const mr = byMonth.get(ym) || [];
    const byOrg = {};
    for (const o of orgs) byOrg[o.short] = r1(sum(mr.filter((r) => r.org_id === o.id)));
    const kg = sum(mr);
    return {
      month: ym, label: monthLabel(ym), kg: r1(kg), byOrg,
      perDay: r1(kg / coveredDays(ym)),
      recyclableShare: kg ? r1((sum(mr.filter((r) => r.recyclable === 2)) / kg) * 100) : 0,
      recycledShare: kg ? r1((sum(mr.filter((r) => r.is_recycling)) / kg) * 100) : 0,
      co2: r1(sum(mr, (r) => r.co2)),
    };
  });

  const byTypeMap = groupBy(rows, 'type_name');
  const byType = [...byTypeMap.entries()].map(([name, rs]) => ({ name, kg: r1(sum(rs)), recyclable: !!rs[0].recyclable }))
    .sort((a, b) => b.kg - a.kg);
  const byOrg = orgs.map((o) => ({ name: o.short, kg: r1(sum(rows.filter((r) => r.org_id === o.id))) }));
  const byMethod = [...groupBy(rows, 'method_name').entries()].map(([name, rs]) => ({ name, kg: r1(sum(rs)) }))
    .sort((a, b) => b.kg - a.kg);

  const total = sum(rows);
  const kpi = {
    totalKg: r1(total),
    co2: r1(sum(rows, (r) => r.co2)),
    co2Potential: r1(sum(rows, (r) => r.co2Potential)),
    recyclableShare: total ? r1((sum(rows.filter((r) => r.recyclable === 2)) / total) * 100) : 0,
    recycledShare: total ? r1((sum(rows.filter((r) => r.is_recycling)) / total) * 100) : 0,
    partialShare: total ? r1((sum(rows.filter((r) => r.recyclable === 1)) / total) * 100) : 0,
    entries: rows.length,
  };

  // месяцы, по которым уже есть принятые данные (текущий месяц без принятых отчётов не искажает сравнения)
  const dataMonths = months.filter((m) => byMonth.has(m));
  const compare = comparePeriods(rows, dataMonths);
  // для коротких периодов (месяц/квартал) база для отклонений берётся из 3 предыдущих месяцев
  let anomalies;
  if (anomalyFrom) {
    const ext = await registryRows({ tenantId, from: anomalyFrom, to, orgId, statuses });
    const extMonths = monthsBetween(anomalyFrom.slice(0, 7), to.slice(0, 7)).filter((m) => ext.some((r) => r.date.startsWith(m)));
    anomalies = findAnomalies(ext, extMonths).filter((a) => a.month >= from.slice(0, 7));
  } else anomalies = findAnomalies(rows, dataMonths);
  const insights = await buildInsights({ tenantId, rows, months: dataMonths, monthly, byType, byOrg, kpi, compare, anomalies, orgs, from, to });
  // какие продукты выбрасывают (если при вводе указан продукт) и во сколько это обходится по ценам справочника
  const byProduct = [...groupBy(rows.filter((r) => r.product_name), "product_name").entries()].map(([name, rs]) => ({ name, kg: r1(sum(rs)), kzt: Math.round(sum(rs, (r) => r.kg * (r.price_kzt_kg || 0))) })).sort((a, b) => b.kg - a.kg).slice(0, 12);
  return { from, to, months, orgs: orgs.map((o) => o.short), monthly, byType, byOrg, byMethod, byProduct, kpi, compare, anomalies, insights };
}

// Сравнение периодов: последний месяц к предыдущему, квартал к кварталу (по среднесуточному)
function comparePeriods(rows, months) {
  // сравниваем только организации, у которых есть принятые данные в обоих периодах (like-for-like)
  const orgsIn = (ms) => new Set(rows.filter((r) => ms.includes(r.date.slice(0, 7))).map((r) => r.org_id));
  let common = null;
  // среднесуточный объём: по каждой организации делим на дни только тех месяцев, где у неё есть принятые данные
  const perDay = (ms) => {
    const rs = rows.filter((r) => ms.includes(r.date.slice(0, 7)) && (!common || common.has(r.org_id)));
    let pd = 0; const days = ms.reduce((a, m) => a + coveredDays(m), 0);
    for (const [, ors] of groupBy(rs, 'org_id')) {
      const om = new Set(ors.map((r) => r.date.slice(0, 7)));
      pd += sum(ors) / [...om].reduce((a, m) => a + coveredDays(m), 0);
    }
    return { kg: sum(rs), perDay: pd, days };
  };
  const out = {};
  if (months.length >= 2) {
    const a = months[months.length - 1], b = months[months.length - 2];
    const oa = orgsIn([a]); common = new Set([...orgsIn([b])].filter((x) => oa.has(x)));
    const A = perDay([a]), B = perDay([b]);
    out.mom = { cur: monthLabel(a), prev: monthLabel(b), curKg: r1(A.kg), prevKg: r1(B.kg), curPerDay: r1(A.perDay), prevPerDay: r1(B.perDay), changePct: r1(pct(A.perDay, B.perDay) ?? 0) };
  }
  if (months.length >= 6) {
    const q = (ym) => `${ym.slice(0, 4)}-Q${Math.ceil(+ym.slice(5, 7) / 3)}`;
    // только полные кварталы (3 месяца принятых данных), иначе неполный квартал даёт ложный «рост»
    const qs = [...new Set(months.map(q))].filter((x) => months.filter((m) => q(m) === x).length === 3);
    if (qs.length >= 2) {
      const qa = qs[qs.length - 1], qb = qs[qs.length - 2];
      const ma = months.filter((m) => q(m) === qa), mb = months.filter((m) => q(m) === qb);
      const oa = orgsIn(ma); common = new Set([...orgsIn(mb)].filter((x) => oa.has(x)));
      const A = perDay(months.filter((m) => q(m) === qa)), B = perDay(months.filter((m) => q(m) === qb));
      out.qoq = { cur: qa.replace('-Q', ' Q'), prev: qb.replace('-Q', ' Q'), curKg: r1(A.kg), prevKg: r1(B.kg), curPerDay: r1(A.perDay), prevPerDay: r1(B.perDay), changePct: r1(pct(A.perDay, B.perDay) ?? 0) };
    }
  }
  return out;
}

// Отклонения: месячный объём вида отхода организации > среднего за предыдущие 3 мес. на N%
function findAnomalies(rows, months) {
  const out = [];
  // рабочие дни организации в месяце = дни, за которые есть записи (лабораторные занятия, смены)
  const activeDays = {};
  for (const r of rows) { const k = `${r.org_id}|${r.date.slice(0, 7)}`; (activeDays[k] ??= new Set()).add(r.date); }
  const ad = (org, ym) => activeDays[`${org}|${ym}`]?.size || 0;
  const byKey = groupBy(rows, (r) => `${r.org_id}|${r.type_id}`);
  for (const [, rs] of byKey) {
    const org = rs[0].org_id;
    const perMonth = {};
    for (const r of rs) { const ym = r.date.slice(0, 7); perMonth[ym] = (perMonth[ym] || 0) + r.kg; }
    for (let i = 3; i < months.length; i++) {
      const ym = months[i];
      if (!ad(org, ym)) continue;
      const cur = (perMonth[ym] || 0) / ad(org, ym);
      const prev = months.slice(i - 3, i).filter((m) => ad(org, m)).map((m) => (perMonth[m] || 0) / ad(org, m)).filter((x) => x > 0);
      if (prev.length < 2) continue;
      const avg = prev.reduce((a, b) => a + b, 0) / prev.length;
      const ch = pct(cur, avg);
      const extra = (cur - avg) * ad(org, ym);
      if (ch > ANOMALY_PCT && extra > 15) {
        out.push({ month: ym, monthLabel: monthLabel(ym), org: rs[0].org_short, orgId: org, type: rs[0].type_name,
          curPerDay: r1(cur), avgPerDay: r1(avg), changePct: Math.round(ch), extraKg: r1(extra) });
      }
    }
  }
  return out.sort((a, b) => b.month.localeCompare(a.month) || b.changePct - a.changePct);
}

// Рекомендации по ключевым словам вида отхода
const ADVICE = [
  [/нереализ/i, 'скорректировать план выпуска по данным продаж, вечерние скидки, передача излишков на благотворительность'],
  [/из зала/i, 'уменьшить базовую порцию гарнира, ввести «половинную порцию», опрос о блюдах, которые не доедают'],
  [/очистк|фрукт|овощ/i, 'закупать часть овощей очищенными/калиброванными; очистки — на компост'],
  [/обрезк/i, 'использовать обрезки в фарш/бульоны, пересмотреть техкарты разделки'],
  [/масл/i, 'сдавать отработанное масло на биодизель (раздельный сбор), контроль фритюра по тестеру'],
  [/жмых/i, 'кофейный жмых — на компост/субстрат, а не в ТБО'],
  [/картон|упаков|тара/i, 'раздельный сбор картона и упаковки — вторсырьё вместо полигона'],
  [/пэт|стекл|алюм|банк/i, 'отдельный контейнер для ПЭТ/стекла/алюминия — сдача во вторсырьё'],
  [/кост/i, 'передача костей на переработку (костная мука/корма)'],
  [/скорлуп/i, 'яичная скорлупа — компост/минеральная подкормка'],
  [/образц|хлеб|кондит/i, 'уменьшить массу лабораторных закладок до минимально необходимой по методике'],
];
const adviceFor = (name) => (ADVICE.find(([re]) => re.test(name)) || [, 'проанализировать причины образования и норматив'])[1];

async function buildInsights({ tenantId, rows, months, monthly, byType, byOrg, kpi, compare, anomalies, orgs, from, to }) {
  const ins = [];
  if (!rows.length) return [{ level: 'info', title: 'Нет данных', text: 'За выбранный период нет принятых отчётов.' }];
  const days = months.reduce((a, m) => a + coveredDays(m), 0) || 1;
  const perDay = kpi.totalKg / days;

  ins.push({ level: 'info', title: 'Итог периода',
    text: `Образовано ${kgOrT(kpi.totalKg)} отходов (≈${fmt(perDay, 1)} кг/день), углеродный след ≈ ${kgOrT(kpi.co2)} CO₂-экв. Годовой прогноз при текущем темпе — ${kgOrT(perDay * 365)}.` });

  if (compare.mom) {
    const c = compare.mom; const up = c.changePct > 0;
    ins.push({ level: Math.abs(c.changePct) < 5 ? 'info' : up ? 'warn' : 'good', title: 'Динамика месяц к месяцу',
      text: `${c.cur} к ${c.prev}: ${up ? '+' : ''}${fmt(c.changePct, 1)}% по среднесуточному объёму (${fmt(c.curPerDay, 1)} против ${fmt(c.prevPerDay, 1)} кг/день).` });
  }
  if (compare.qoq) {
    const c = compare.qoq;
    ins.push({ level: c.changePct > 5 ? 'warn' : c.changePct < -5 ? 'good' : 'info', title: 'Квартал к кварталу',
      text: `${c.cur} к ${c.prev}: ${c.changePct > 0 ? '+' : ''}${fmt(c.changePct, 1)}% по среднесуточному объёму.` });
  }

  const top = byType.slice(0, 2);
  const topShare = top.reduce((a, t) => a + t.kg, 0) / kpi.totalKg * 100;
  ins.push({ level: 'tip', title: 'Главные источники',
    text: `${top.map((t) => `«${t.name}» — ${Math.round(t.kg / kpi.totalKg * 100)}%`).join(', ')}. Вместе ${Math.round(topShare)}% всей массы. Меры: ${adviceFor(top[0].name)}.` });

  if (orgs.length > 1) {
    const lead = [...byOrg].sort((a, b) => b.kg - a.kg)[0];
    ins.push({ level: 'info', title: 'Вклад организаций',
      text: `${lead.name} даёт ${Math.round(lead.kg / kpi.totalKg * 100)}% массы — приоритет для пилотных мер по сокращению.` });
  }

  for (const a of anomalies.slice(0, 3)) {
    ins.push({ level: 'warn', title: `Отклонение: ${a.org}`,
      text: `«${a.type}» в ${a.monthLabel}: +${a.changePct}% к среднему за 3 мес. (≈${fmt(a.extraKg, 0)} кг сверх нормы). Рекомендация: ${adviceFor(a.type)}.` });
  }

  const gap = kpi.recyclableShare - kpi.recycledShare;
  if (gap > 5) {
    const yearPot = kpi.co2Potential / days * 365;
    ins.push({ level: 'tip', title: 'Потенциал переработки',
      text: `По справочнику пригодно к переработке ${fmt(kpi.recyclableShare, 1)}% массы (ещё ${fmt(kpi.partialShare, 1)}% — частично, через биогаз), мимо полигона сейчас уходит лишь ${fmt(kpi.recycledShare, 1)}%. Перевод на рекомендуемые способы справочника (компост, биогаз, вторсырьё, фудшеринг) снизит выбросы ≈ на ${kgOrT(yearPot)} CO₂-экв. в год.` });
  } else if (kpi.recyclableShare > 0) {
    ins.push({ level: 'good', title: 'Переработка', text: `Почти все пригодные к переработке фракции уже направляются на переработку (${kpi.recycledShare}%).` });
  }

  const unsold = rows.filter((r) => /нереализ/i.test(r.type_name));
  if (unsold.length) {
    const kg = sum(unsold);
    ins.push({ level: 'warn', title: 'Финансовые потери',
      text: `Нереализованная продукция: ${kgOrT(kg)} за период ≈ ${fmt(kg * UNSOLD_PRICE_KZT / 1e6, 2)} млн ₸ (допущение ${fmt(UNSOLD_PRICE_KZT)} ₸/кг). Сокращение на 30% сэкономит ≈ ${fmt(kg * UNSOLD_PRICE_KZT * 0.3 / days * 365 / 1e6, 1)} млн ₸ в год.` });
  }

  // День недели с максимальным образованием (общепит)
  const catering = rows.filter((r) => ['столовая', 'гостиница', 'кофейня'].includes(r.org_type));
  if (catering.length > 30) {
    const byWd = Array(7).fill(0).map(() => ({ kg: 0, days: new Set() }));
    for (const r of catering) { const d = new Date(r.date + 'T00:00:00').getDay(); byWd[d].kg += r.kg; byWd[d].days.add(r.date); }
    const avg = byWd.map((x, i) => ({ i, v: x.days.size ? x.kg / x.days.size : 0 })).filter((x) => x.v > 0);
    const mean = avg.reduce((a, x) => a + x.v, 0) / avg.length;
    const mx = avg.sort((a, b) => b.v - a.v)[0];
    if (mx && pct(mx.v, mean) > 10) {
      ins.push({ level: 'tip', title: 'Пиковый день недели',
        text: `В общепите больше всего отходов ${mx.i === 2 ? 'во' : 'в'} ${WD[mx.i]} (+${Math.round(pct(mx.v, mean))}% к среднему дню) — скорректировать меню и объём заготовки на этот день.` });
    }
  }

  // ЦУР 12.3
  ins.push({ level: 'info', title: 'Цель ЦУР 12.3',
    text: `Чтобы сократить пищевые отходы вдвое к 2030 г., нужно снижать объём на ≈${fmt(perDay * 0.5 / 4, 1)} кг/день ежегодно (≈12,5% в год от текущих ${fmt(perDay, 1)} кг/день).` });

  // Несдавшие за последний закрытый месяц
  const lastClosed = months.filter((m) => m < today().slice(0, 7)).pop();
  if (lastClosed) {
    const miss = (await missingReports(tenantId, lastClosed)).filter((o) => orgs.some((x) => x.id === o.id));
    if (miss.length) ins.push({ level: 'warn', title: 'Несданные отчёты', text: `За ${monthFull(lastClosed)} нет принятого отчёта: ${miss.map((m) => m.short).join(', ')}.` });
  }
  return ins;
}

// Организации без принятого отчёта за период
function missingReports(tenantId, period) {
  return db.prepare(`
    SELECT o.id, o.name, o.short, COALESCE(r.status, 'нет отчёта') status
    FROM organizations o LEFT JOIN reports r ON r.org_id = o.id AND r.period = ?
    WHERE o.active = 1 AND o.tenant_id = ? AND (r.status IS NULL OR r.status <> 'accepted') ORDER BY o.id`).all(period, +tenantId);
}

// ---------- Сводный отчёт ----------
async function summary(tenantId, kind, value) {
  const pr = periodRange(kind, value);
  const rows = await registryRows({ tenantId, from: pr.from, to: pr.to });
  const orgs = await db.prepare('SELECT * FROM organizations WHERE active=1 AND tenant_id=? ORDER BY id').all(+tenantId);
  const out = [];
  for (const o of orgs) {
    const orows = rows.filter((r) => r.org_id === o.id);
    const types = [...groupBy(orows, 'type_name').entries()].map(([name, rs]) => ({
      name, unit: rs[0].unit, recyclable: rs[0].recyclable,
      byMonth: pr.months.map((m) => r1(sum(rs.filter((r) => r.date.startsWith(m)), (r) => r.qty))),
      qty: r1(sum(rs, (r) => r.qty)), kg: r1(sum(rs)), co2: r1(sum(rs, (r) => r.co2)),
      methods: [...new Set(rs.map((r) => r.method_name))].join(', '),
    })).sort((a, b) => b.kg - a.kg);
    const statuses = [];
    for (const m of pr.months) statuses.push((await db.prepare('SELECT status FROM reports WHERE org_id=? AND period=?').get(o.id, m))?.status || 'нет');
    out.push({ id: o.id, name: o.name, short: o.short, type: o.type, types, statuses,
      kg: r1(sum(orows)), co2: r1(sum(orows, (r) => r.co2)), recyclableKg: r1(sum(orows.filter((r) => r.recyclable === 2))) });
  }
  const total = sum(rows);
  const back = new Date(pr.from + 'T00:00:00Z'); back.setUTCMonth(back.getUTCMonth() - 3);
  const dash = await dashboard({ tenantId, from: pr.from, to: pr.to, anomalyFrom: back.toISOString().slice(0, 10) });
  return {
    kind, value, label: pr.label, from: pr.from, to: pr.to, months: pr.months.map(monthLabel), monthKeys: pr.months,
    orgs: out, totalKg: r1(total), totalCo2: r1(sum(rows, (r) => r.co2)),
    recyclableShare: total ? r1(sum(rows.filter((r) => r.recyclable === 2)) / total * 100) : 0,
    recycledShare: total ? r1(sum(rows.filter((r) => r.is_recycling)) / total * 100) : 0,
    insights: dash.insights, anomalies: dash.anomalies, rows,
  };
}

// ---------- Автопроверка отчёта для проверяющего ----------
async function reportChecks(reportId) {
  const rep = await db.prepare('SELECT r.*, o.type org_type FROM reports r JOIN organizations o ON o.id=r.org_id WHERE r.id=?').get(reportId);
  const rows = await registryRows({ reportId, statuses: ['draft', 'submitted', 'in_review', 'accepted', 'returned'] });
  const checks = [];
  if (!rows.length) return [{ level: 'warn', text: 'В отчёте нет ни одной записи.' }];

  // сравнение со средним по принятым отчётам организации за 3 прошлых месяца
  const prev = (await db.prepare(`SELECT period FROM reports WHERE org_id=? AND status='accepted' AND period < ? ORDER BY period DESC LIMIT 3`).all(rep.org_id, rep.period)).map((x) => x.period);
  const cd = coveredDays(rep.period);
  const curPerDay = sum(rows) / cd;
  if (prev.length) {
    const prows = (await registryRows({ orgId: rep.org_id })).filter((r) => prev.includes(r.period));
    const avg = sum(prows) / prev.reduce((a, m) => a + daysInMonth(m), 0);
    const ch = pct(curPerDay, avg);
    checks.push({ level: Math.abs(ch) > ANOMALY_PCT ? 'warn' : 'good',
      text: `Среднесуточный объём ${fmt(curPerDay, 1)} кг/день — ${ch > 0 ? '+' : ''}${Math.round(ch)}% к среднему за ${prev.length} мес. (${fmt(avg, 1)} кг/день).` });
    // по видам
    for (const [name, rs] of groupBy(rows, 'type_name')) {
      const p = prows.filter((r) => r.type_name === name);
      if (!p.length) { checks.push({ level: 'info', text: `Новый вид отхода в этом месяце: «${name}».` }); continue; }
      const a = sum(p) / prev.reduce((x, m) => x + daysInMonth(m), 0);
      const c = pct(sum(rs) / cd, a);
      if (c > 50) checks.push({ level: 'warn', text: `«${name}»: +${Math.round(c)}% к обычному уровню — уточнить причину.` });
    }
  } else {
    checks.push({ level: 'info', text: 'Нет принятых отчётов за прошлые месяцы для сравнения.' });
  }
  // дубли
  const dupKey = groupBy(rows, (r) => `${r.date}|${r.type_id}|${r.qty}`);
  const dups = [...dupKey.values()].filter((g) => g.length > 1);
  if (dups.length) checks.push({ level: 'warn', text: `Возможные дубли: ${dups.length} (одинаковые дата, вид и вес), напр. ${dups[0][0].date} «${dups[0][0].type_name}» ${dups[0][0].qty} ${dups[0][0].unit}.` });
  else checks.push({ level: 'good', text: 'Дублирующихся записей не найдено.' });
  // пропуски рабочих дней для общепита
  if (['столовая', 'гостиница', 'кофейня'].includes(rep.org_type)) {
    const dates = new Set(rows.map((r) => r.date));
    const miss = [];
    for (let d = 1; d <= cd; d++) {
      const ds = `${rep.period}-${String(d).padStart(2, '0')}`;
      if (new Date(ds + 'T00:00:00').getDay() !== 0 && !dates.has(ds)) miss.push(d);
    }
    checks.push(miss.length ? { level: 'warn', text: `Нет записей за рабочие дни: ${miss.slice(0, 10).join(', ')}${miss.length > 10 ? '…' : ''} (${miss.length} дн.).` }
      : { level: 'good', text: 'Записи есть за все рабочие дни.' });
  }
  const noPhoto = rows.filter((r) => !r.photo).length;
  checks.push({ level: 'info', text: `Записей: ${rows.length}, с фото: ${rows.length - noPhoto}.` });
  return checks;
}

// Быстрая сводка периода для «Моей недели», бота и кнопок отчёта.
// statuses: по умолчанию все статусы — оперативные данные организации, а не только принятые.
const ALL_ST = ['draft', 'submitted', 'in_review', 'accepted', 'returned'];
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
async function periodStats({ tenantId, orgId, from, to, statuses = ALL_ST }) {
  const rows = await registryRows({ tenantId, from, to, orgId, statuses });
  const days = Math.round((new Date(to) - new Date(from)) / 864e5) + 1;
  const pFrom = addDays(from, -days), pTo = addDays(from, -1);
  const prev = await registryRows({ tenantId, from: pFrom, to: pTo, orgId, statuses });
  const kg = sum(rows), pkg = sum(prev);
  const byType = [...groupBy(rows, 'type_name').entries()].map(([name, rs]) => ({ name, unit: rs[0].unit, qty: r1(sum(rs, (r) => r.qty)), kg: r1(sum(rs)) })).sort((a, b) => b.kg - a.kg);
  const byDay = []; for (let i = 0; i < days && i < 400; i++) { const d = addDays(from, i); byDay.push({ date: d, kg: r1(sum(rows.filter((r) => r.date === d))) }); }
  return { from, to, prevFrom: pFrom, prevTo: pTo, days, kg: r1(kg), prevKg: r1(pkg), changePct: pkg ? r1(pct(kg, pkg)) : null,
    co2: r1(sum(rows, (r) => r.co2)), co2Potential: r1(sum(rows, (r) => r.co2Potential)), entries: rows.length,
    diverted: kg ? r1(sum(rows.filter((r) => r.is_recycling)) / kg * 100) : 0, byType, byDay, rows };
}
// типовые периоды: week (7 дней по сегодня), month, quarter, prev_month, prev_quarter
function namedPeriod(name) {
  const t = today(); const y = +t.slice(0, 4), m = +t.slice(5, 7); const q = Math.ceil(m / 3);
  const mStart = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  const mEnd = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-${new Date(yy, mm, 0).getDate()}`;
  if (name === 'week') return { from: addDays(t, -7), to: addDays(t, -1), label: '7 полных дней' }; // без неполного «сегодня» — честное сравнение с прошлой неделей
  if (name === 'month') return { from: mStart(y, m), to: t, label: monthFull(t.slice(0, 7)) };
  if (name === 'prev_month') { const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y; return { from: mStart(py, pm), to: mEnd(py, pm), label: monthFull(`${py}-${String(pm).padStart(2, '0')}`) }; }
  if (name === 'prev_quarter') { const pq = q === 1 ? 4 : q - 1, py = q === 1 ? y - 1 : y; return { from: mStart(py, pq * 3 - 2), to: mEnd(py, pq * 3), label: `${pq} квартал ${py}` }; }
  return { from: mStart(y, q * 3 - 2), to: t, label: `${q} квартал ${y}` };
}

module.exports = { addDays, periodStats, namedPeriod, ALL_ST, minPeriod, registryRows, dashboard, summary, reportChecks, missingReports, periodRange, monthsBetween, monthLabel, monthFull, today, ANOMALY_PCT, UNSOLD_PRICE_KZT };
