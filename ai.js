// ИИ-слой: Claude формулирует выводы и разбирает свободный ввод.
// Принцип: числа считают правила (analytics.js), ИИ только формулирует и распознаёт.
// Без ключа или при ошибке/тайм-ауте — детерминированный запасной режим, экран никогда не пустой.
const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk').default;
const { db, nowIso } = require('./db');
const PROD = require('./products');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 12000);
const enabled = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
let client = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 1, timeout: TIMEOUT_MS }));


async function ask(system, user, effort = 'low') {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // при отказе модели запрос автоматически перезапускается на резервной модели
    output_config: { effort },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refusal');
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

// ---------- 1. ИИ-заключение к отчёту ----------
const CONCLUSION_SYSTEM = `Ты — аналитик по учёту пищевых отходов организации (Казахстан): университет, общепит, производство, ритейл или домашняя кухня.
Тебе дают JSON с фактами, которые уже посчитала система учёта. Напиши заключение для руководства на русском языке:
— 1 абзац «Итог» (3–4 предложения): главное о динамике, структуре и экологии;
— «Что сделать в следующем периоде»: 3 конкретных действия с ответственной организацией, по приоритету.
Используй ТОЛЬКО числа из JSON, не придумывай новых чисел, процентов и фактов. Если данных мало — так и скажи.
Без markdown-заголовков, без таблиц; действия — нумерованным списком. Объём до 140 слов.`;

function rulesConclusion(facts) {
  const ins = facts.insights || [];
  const pick = (lv) => ins.filter((i) => i.level === lv);
  const head = ins.find((i) => i.title === 'Итог периода');
  const actions = [...pick('warn'), ...pick('tip')].filter((i) => /Рекомендация|Меры|снизит|сэкономит/.test(i.text)).slice(0, 3);
  return [
    `Итог (${facts.period}). ${head ? head.text : ''}`.trim(),
    actions.length ? 'Что сделать в следующем периоде:\n' + actions.map((a, i) => `${i + 1}. ${a.title}: ${a.text.split('Рекомендация: ').pop().split('Меры: ').pop()}`).join('\n') : '',
  ].filter(Boolean).join('\n\n');
}

async function conclusion(facts) {
  const key = crypto.createHash('sha256').update(MODEL + JSON.stringify(facts)).digest('hex');
  const cached = await db.prepare('SELECT text FROM ai_cache WHERE key=?').get(key);
  if (cached) return { text: cached.text, source: 'ai', cached: true };
  if (!enabled()) return { text: rulesConclusion(facts), source: 'rules', reason: 'ИИ не подключён (нет ключа API)' };
  try {
    const text = await ask(CONCLUSION_SYSTEM, JSON.stringify(facts));
    if (!text) throw new Error('empty');
    await db.prepare('INSERT INTO ai_cache (key, kind, text, created_at) VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET text=excluded.text, created_at=excluded.created_at').run(key, 'conclusion', text, nowIso());
    return { text, source: 'ai' };
  } catch (e) {
    return { text: rulesConclusion(facts), source: 'rules', reason: `ИИ недоступен (${e.status || e.message}) — показан вывод по правилам` };
  }
}

function topTypesFromOrgs(orgs = []) {
  const m = {};
  for (const o of orgs) for (const t of o.types || []) m[t.name] = (m[t.name] || 0) + t.kg;
  return Object.entries(m).map(([name, kg]) => ({ name, kg: Math.round(kg * 10) / 10 })).sort((a, b) => b.kg - a.kg);
}
// Факты для заключения: только агрегаты, без ФИО (персональные данные в ИИ не передаются)
function factsFrom(label, d) {
  return {
    period: label,
    total_kg: d.kpi?.totalKg ?? d.totalKg, co2_kg: d.kpi?.co2 ?? d.totalCo2,
    recyclable_share_pct: d.kpi?.recyclableShare ?? d.recyclableShare, recycled_share_pct: d.kpi?.recycledShare ?? d.recycledShare,
    top_types: (d.byType || topTypesFromOrgs(d.orgs)).slice(0, 5),
    by_org: d.byOrg || (d.orgs || []).map((o) => ({ name: o.short, kg: o.kg })),
    month_to_month: d.compare?.mom || null,
    anomalies: (d.anomalies || []).slice(0, 5).map(({ monthLabel, org, type, changePct, extraKg }) => ({ month: monthLabel, org, type, changePct, extraKg })),
    insights: (d.insights || []).map(({ level, title, text }) => ({ level, title, text })),
  };
}

// ---------- 2. Разбор свободного ввода («пищевые отходы из зала 12 кило, масло 3 литра») ----------
const num = (s) => Number(String(s).replace(',', '.'));
const UNIT_RE = '(кг|кило\\w*|килограмм\\w*|г|гр|грамм\\w*|л|литр\\w*|l|kg)?';
const stem = (w) => w.toLowerCase().replace(/ё/g, 'е').slice(0, Math.max(4, Math.min(6, w.length - 2)));
const words = (s) => s.toLowerCase().replace(/ё/g, 'е').match(/[a-zа-яәіңғүұқөһ]{3,}/gi) || [];
const STOP = new Set(['отходы', 'отход', 'отходов', 'было', 'сегодня', 'еще', 'ещё', 'итого', 'примерно', 'около']);

function rulesParse(text, types, products = []) {
  const out = [];
  // делим на фрагменты по запятым, «и», точкам с запятой
  const parts = String(text).split(/[;\n]|,(?!\d)| и | плюс /i).map((s) => s.trim()).filter(Boolean);
  for (const p of parts) {
    const m = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${UNIT_RE}`, 'i').exec(p);
    if (!m) continue;
    let qty = num(m[1]); const u = (m[2] || '').toLowerCase();
    if (/^(г|гр|грамм)/.test(u)) qty = qty / 1000;
    const rest = p.replace(m[0], ' ');
    // 1) сначала продукт из датасета («хлеб», «картошка», «плов») → вид отхода организации
    const prod = PROD.findProduct(rest, products);
    const pt = prod && PROD.typeFor(prod, types);
    if (pt && qty > 0) { out.push({ waste_type_id: pt.id, product_id: prod.id, product: prod.name, qty: Math.round(qty * 100) / 100, confidence: 0.9, fragment: p }); continue; }
    const pw = words(rest).filter((w) => !STOP.has(w)).map(stem);
    let best = null, bestScore = 0;
    for (const t of types) {
      const tw = words(t.name).filter((w) => !STOP.has(w)).map(stem);
      const score = tw.filter((w) => pw.some((x) => x.startsWith(w.slice(0, 4)) && (w.startsWith(x.slice(0, 4))))).length / Math.max(1, tw.length);
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best && bestScore > 0 && qty > 0) out.push({ waste_type_id: best.id, qty: Math.round(qty * 100) / 100, confidence: Math.round(bestScore * 100) / 100, fragment: p });
  }
  return out;
}

const PARSE_SYSTEM = `Ты разбираешь фразу сотрудника столовой/кафедры о взвешивании пищевых отходов.
Сопоставь каждое упоминание с видом отхода СТРОГО из переданного справочника видов (по id) и извлеки количество в единице этого вида (кг или л; граммы переведи в кг).
Если упомянут конкретный продукт из справочника продуктов (хлеб, рис, картофель…) — укажи его product_id, иначе null.
Фраза может быть на русском или казахском.
Ответ — только JSON без пояснений: {"items":[{"waste_type_id":число,"product_id":число|null,"qty":число,"fragment":"исходный кусок фразы"}],"unknown":["что не удалось сопоставить"]}.
Если вид не найден в справочнике — положи его в unknown, не выдумывай id.`;

function validItems(items, types, products) {
  return (items || []).filter((x) => types.some((t) => t.id === +x.waste_type_id) && num(x.qty) > 0).map((x) => {
    const p = products.find((y) => y.id === +x.product_id);
    return { waste_type_id: +x.waste_type_id, product_id: p ? p.id : null, product: p ? p.name : null, qty: Math.round(num(x.qty) * 100) / 100,
      fragment: x.fragment || '', ...(x.qty_source ? { qty_source: x.qty_source === 'scale' ? 'scale' : 'estimate' } : {}) };
  });
}
const refJson = (types, products) => `Справочник видов: ${JSON.stringify(types.map((t) => ({ id: t.id, name: t.name, unit: t.unit })))}
Справочник продуктов: ${JSON.stringify(products.map((p) => ({ id: p.id, name: p.name })))}`;
const jsonOf = (raw) => JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));

async function parse(text, types) {
  const products = await PROD.list();
  const valid = (items) => validItems(items, types, products);
  if (enabled()) {
    try {
      const raw = await ask(PARSE_SYSTEM, `${refJson(types, products)}\nФраза: «${String(text).slice(0, 500)}»`);
      const json = jsonOf(raw);
      const items = valid(json.items);
      if (items.length) return { items, unknown: json.unknown || [], source: 'ai' };
    } catch (e) { /* падаем в правила */ }
  }
  return { items: rulesParse(text, types, products), unknown: [], source: 'rules' };
}

// ---------- 3. Распознавание по фото: продукт/вид отхода и вес (с табло весов или оценка) ----------
const PHOTO_SYSTEM = `Ты смотришь на фото с кухни столовой/кафе: пищевые отходы, тара или табло электронных весов.
Определи, какие отходы на фото, и сопоставь их СТРОГО со справочником видов (по id) и, если возможно, со справочником продуктов (product_id).
Вес: если на фото видно табло весов — прочитай число (qty_source "scale"); иначе оцени вес на глаз (qty_source "estimate") и будь осторожен.
Ответ — только JSON без пояснений: {"items":[{"waste_type_id":число,"product_id":число|null,"qty":число,"qty_source":"scale"|"estimate","fragment":"что видно, 3–6 слов"}],"note":"короткий комментарий для сотрудника"}.
Если на фото нет отходов — {"items":[],"note":"..."}.`;

async function photo(dataUrl, types) {
  if (!enabled()) return { items: [], source: 'off', note: 'ИИ не подключён (нет ключа API) — распознавание по фото недоступно, фото можно прикрепить к записи' };
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Нужно фото в формате JPEG/PNG');
  const products = await PROD.list();
  try {
    const response = await getClient().beta.messages.create({
      model: MODEL, max_tokens: 1500, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' },
      system: PHOTO_SYSTEM,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
        { type: 'text', text: refJson(types, products) },
      ] }],
    }, { timeout: Math.max(TIMEOUT_MS, 25000) });
    if (response.stop_reason === 'refusal') throw new Error('refusal');
    const json = jsonOf(response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim());
    return { items: validItems(json.items, types, products), note: String(json.note || '').slice(0, 300), source: 'ai' };
  } catch (e) {
    return { items: [], source: 'error', note: `Не удалось распознать фото (${e.status || e.message}) — внесите вручную, фото прикрепится к записи` };
  }
}

module.exports = { enabled, MODEL, conclusion, factsFrom, parse, rulesParse, photo };
