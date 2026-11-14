// Wasteless — сервер. Мультиарендное приложение: у каждой компании (tenant) свои подразделения, пользователи и данные.
// Типы аккаунтов: компания (роли admin/reviewer/manager/resp), личный (personal — домашний учёт), демо (только чтение).
// .env (без зависимостей): KEY=value построчно; уже заданные переменные окружения не перезаписываются
try {
  for (const line of require('fs').readFileSync(require('path').join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env нет — работаем без него */ }
const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, init, hashPassword, checkPassword, nowIso } = require('./db');
const A = require('./analytics');
const { buildSummaryXlsx, buildEntriesXlsx, buildEntriesCsv } = require('./export');
const AI = require('./ai');
const PROD = require('./products');
const GOALS = require('./goals');
const FC = require('./forecast');
const REF = require('./reference');
const ACC = require('./accounts');

const PORT = Number(process.env.PORT || 3000);
const UPLOADS = process.env.UPLOADS_DIR || path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
// владельцы платформы (через запятую): правят общие справочники способов утилизации и продуктов
const PLATFORM_ADMINS = new Set(String(process.env.PLATFORM_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));

let BOT = { state: { enabled: false }, notifyReport() {} };
const app = express();
// async-обработчики: ошибка в промисе уходит в общий обработчик ошибок, а не роняет процесс
for (const m of ['get', 'post', 'put', 'delete']) {
  const orig = app[m].bind(app);
  app[m] = (p, ...hs) => (hs.length ? orig(p, ...hs.map((h) => (typeof h === 'function' && h.length < 4
    ? (req, res, next) => { try { const r = h(req, res, next); if (r && r.catch) r.catch(next); } catch (e) { next(e); } } : h))) : orig(p));
}
// за прокси (cloudflared локально, Railway в облаке) https и внешний адрес берутся из X-Forwarded-*
app.set('trust proxy', process.env.RAILWAY_ENVIRONMENT || process.env.TRUST_PROXY ? 1 : 'loopback');
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.secure && BOT.setWebAppUrl) { const host = req.get('host') || ''; if (host && !/^(localhost|127\.)/.test(host)) BOT.setWebAppUrl(`https://${host}`); }
  next();
});
// «/» — лендинг, «/app» — приложение. Старые ссылки /?tg=1 ведём в приложение.
const PUB = path.join(__dirname, 'public');
app.get('/', (req, res) => (req.query.tg ? res.redirect('/app?tg=1') : res.sendFile(path.join(PUB, 'landing.html'))));
app.get(['/welcome', '/about'], (_req, res) => res.redirect('/'));
app.get('/app', (req, res) => {
  if (req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, '/app' + (req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : ''));
  res.sendFile(path.join(PUB, 'index.html'));
});
app.use(express.static(PUB, { index: false }));

const EDITABLE = ['draft', 'returned'];
const STATUS_RU = { draft: 'черновик', submitted: 'отправлено', in_review: 'на проверке', accepted: 'принято', returned: 'возвращено на доработку' };
const STAFF = ['reviewer', 'admin', 'manager'];
const ENTRY_ROLES = ['resp', 'personal']; // кто вносит взвешивания
const isEntry = (u) => ENTRY_ROLES.includes(u.role);
const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ error: msg, ...extra });
const SESSION_DAYS = 30;

// ---------- auth ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
    const i = c.indexOf('='); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
}
const loadUser = (where, ...p) => db.prepare(`SELECT u.id, u.full_name, u.email, u.role, u.org_id, u.lang, u.tenant_id, u.tg_chat_id,
    o.name org_name, o.short org_short, t.kind tenant_kind, t.name tenant_name
  FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN organizations o ON o.id = u.org_id WHERE ${where}`).get(...p);
app.use(async (req, _res, next) => {
  try {
    const sid = parseCookies(req).sid;
    if (sid) {
      const since = new Date(Date.now() - SESSION_DAYS * 864e5).toISOString();
      req.user = await loadUser('u.id = (SELECT user_id FROM sessions WHERE token = ? AND created_at > ?) AND u.active = 1', sid, since);
      if (req.user) {
        req.user.platform = PLATFORM_ADMINS.has(String(req.user.email).toLowerCase());
        req.user.demo = req.user.tenant_kind === 'demo';
      }
    }
    next();
  } catch (e) { next(e); }
});
// роль 'resp' в списке пропускает и личный аккаунт: у обоих одинаковый сценарий ввода
const auth = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в систему' });
  const ok = !roles.length || roles.includes(req.user.role) || (roles.includes('resp') && req.user.role === 'personal');
  if (!ok) return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
  next();
};
const platformOnly = (req, res, next) => (req.user?.platform ? next() : bad(res, 'Общие справочники платформы меняет только её владелец', 403));
// демо — только просмотр: любые изменения запрещены (кроме выхода и языка интерфейса)
const DEMO_ALLOWED = new Set(['/api/logout', '/api/me/lang', '/api/ai/parse']);
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.user?.demo && !DEMO_ALLOWED.has(req.baseUrl + req.path)) {
    return bad(res, 'Демо — только для просмотра. Зарегистрируйтесь бесплатно, чтобы вносить свои данные.', 403, { demo: true });
  }
  next();
});

async function startSession(res, userId, req) {
  const token = crypto.randomBytes(24).toString('hex');
  await db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, userId, nowIso());
  const secure = req?.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * SESSION_DAYS}${secure}`);
}
// защита от подбора пароля за 15 минут: 8 неудачных попыток на e-mail, 40 — на IP
// (с одного IP могут входить многие: общий Wi-Fi вуза, NAT мобильного оператора)
const attempts = new Map();
function tooMany(key) {
  const now = Date.now(); const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60e3);
  attempts.set(key, a); return a.length >= (key.startsWith('mail:') ? 8 : key.startsWith('reg:') ? 10 : 40);
}
const failAttempt = (key) => attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
setInterval(() => { const now = Date.now(); for (const [k, a] of attempts) if (!a.some((t) => now - t < 15 * 60e3)) attempts.delete(k); }, 10 * 60e3).unref();

app.post('/api/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const kIp = 'ip:' + req.ip, kMail = 'mail:' + email;
  if (tooMany(kIp) || tooMany(kMail)) return bad(res, 'Слишком много попыток входа. Попробуйте через 15 минут.', 429);
  const u = await db.prepare(`SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE lower(u.email) = ? AND u.active = 1 AND t.kind <> 'demo'`).get(email);
  if (!u || !checkPassword(String(req.body?.password || ''), u.pass_hash)) { failAttempt(kIp); failAttempt(kMail); return bad(res, 'Неверный e-mail или пароль', 401); }
  await startSession(res, u.id, req);
  res.json({ ok: true });
});
app.post('/api/logout', async (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) await db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});
const accountErr = (res, e) => { if (e instanceof ACC.AccountError) return bad(res, e.message); throw e; };
// регистрация: kind = company | personal
app.post('/api/register', async (req, res) => {
  const b = req.body || {};
  if (tooMany('reg:' + req.ip)) return bad(res, 'Слишком много регистраций с этого адреса. Попробуйте позже.', 429);
  try {
    const r = b.kind === 'company' ? await ACC.createCompany(b) : await ACC.createPersonal(b);
    failAttempt('reg:' + req.ip);
    await startSession(res, r.userId, req);
    res.json({ ok: true });
  } catch (e) { accountErr(res, e); }
});
// приглашение сотрудника: проверка ссылки и присоединение к компании
app.get('/api/invite/:code', async (req, res) => {
  const inv = await ACC.inviteInfo(req.params.code);
  if (!inv) return bad(res, 'Приглашение недействительно или уже использовано', 404);
  res.json({ company: inv.company, role: inv.role, role_ru: ACC.ROLE_RU[inv.role], org: inv.org_short || null, expires_at: inv.expires_at });
});
app.post('/api/join', async (req, res) => {
  try { const r = await ACC.joinByInvite(req.body || {}); await startSession(res, r.userId, req); res.json({ ok: true }); }
  catch (e) { accountErr(res, e); }
});
// «Посмотреть демо»: вход в демо-компанию выбранной ролью, только просмотр
app.post('/api/demo', async (req, res) => {
  const role = ['resp', 'reviewer', 'manager', 'admin'].includes(req.body?.role) ? req.body.role : 'manager';
  const tn = await require('./seed').demoTenant();
  if (!tn) return bad(res, 'Демо сейчас недоступно', 404);
  const u = role === 'resp'
    ? await db.prepare("SELECT u.id FROM users u JOIN organizations o ON o.id=u.org_id WHERE u.tenant_id=? AND u.role='resp' ORDER BY CASE WHEN o.type='столовая' THEN 0 ELSE 1 END, u.id LIMIT 1").get(tn.id)
    : await db.prepare('SELECT id FROM users WHERE tenant_id=? AND role=? ORDER BY id LIMIT 1').get(tn.id, role);
  if (!u) return bad(res, 'Демо сейчас недоступно', 404);
  await startSession(res, u.id, req);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: req.user ? { ...req.user, tg_chat_id: undefined, tg_linked: !!req.user.tg_chat_id } : null }));
app.put('/api/me/lang', auth(), async (req, res) => {
  const lang = req.body?.lang === 'kz' ? 'kz' : 'ru';
  await db.prepare('UPDATE users SET lang=? WHERE id=?').run(lang, req.user.id);
  res.json({ ok: true, lang });
});
app.put('/api/me/profile', auth(), async (req, res) => {
  const b = req.body || {};
  const name = String(b.full_name ?? req.user.full_name).trim();
  if (name.length < 2) return bad(res, 'Укажите имя');
  const email = String(b.email ?? req.user.email).trim().toLowerCase();
  if (email !== req.user.email.toLowerCase()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return bad(res, 'Укажите корректный e-mail');
    if (await db.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').get(email, req.user.id)) return bad(res, 'Этот e-mail уже занят');
  }
  await db.prepare('UPDATE users SET full_name=?, email=? WHERE id=?').run(name.slice(0, 80), email, req.user.id);
  if (req.user.role === 'personal') await db.prepare('UPDATE tenants SET name=? WHERE id=?').run(`Личный: ${name.slice(0, 80)}`, req.user.tenant_id);
  res.json({ ok: true });
});
app.put('/api/me/password', auth(), async (req, res) => {
  const u = await db.prepare('SELECT pass_hash, email FROM users WHERE id=?').get(req.user.id);
  // аккаунт из Telegram ещё без пароля — текущий не спрашиваем
  const tgOnly = /@telegram\.wasteless$/.test(u.email);
  if (!tgOnly && !checkPassword(String(req.body?.current || ''), u.pass_hash)) return bad(res, 'Текущий пароль неверный');
  try { ACC.checkPasswordRules(req.body?.next); } catch (e) { return accountErr(res, e); }
  await db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(req.body.next), req.user.id);
  // остальные сессии закрываем
  await db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(req.user.id, parseCookies(req).sid || '');
  res.json({ ok: true });
});

// адрес, по которому система доступна снаружи: PUBLIC_URL → адрес из запроса → IP в локальной сети
function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req?.get('host') || '';
  if (host && !/^(localhost|127\.|\[::1\]|\d+\.\d+\.\d+\.\d+)/.test(host)) return `${req.protocol}://${host}`;
  return lanUrl();
}
function lanUrl() {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${PORT}`;
  }
  return `http://localhost:${PORT}`;
}
app.get('/api/info', (req, res) => res.json({ lanUrl: lanUrl(), publicUrl: publicUrl(req), anomalyPct: A.ANOMALY_PCT, today: A.today() }));

// ---------- доступ к данным своей компании ----------
const T = (req) => req.user.tenant_id;
const orgInTenant = (req, id) => db.prepare('SELECT * FROM organizations WHERE id=? AND tenant_id=?').get(+id, T(req));
// подразделение из запроса: ответственный/личный — всегда своё, руководители — любое своей компании
async function orgParam(req) {
  if (isEntry(req.user)) return req.user.org_id;
  const id = +req.query.org || +req.body?.org_id || 0;
  return id && (await orgInTenant(req, id)) ? id : null;
}
async function reportInTenant(req, id) {
  const rep = await db.prepare('SELECT r.* FROM reports r JOIN organizations o ON o.id=r.org_id WHERE r.id=? AND o.tenant_id=?').get(+id, T(req));
  if (!rep || (isEntry(req.user) && rep.org_id !== req.user.org_id)) return null;
  return rep;
}

// ---------- подразделения ----------
app.get('/api/orgs', auth(), async (req, res) => {
  const rows = await db.prepare(`SELECT o.*, (SELECT string_agg(full_name, ', ') FROM users u WHERE u.org_id=o.id AND u.role='resp' AND u.active=1) responsibles
    FROM organizations o WHERE o.tenant_id=? ORDER BY o.id`).all(T(req));
  res.json(STAFF.includes(req.user.role) ? rows : rows.filter((o) => o.active).map(({ id, name, short, type }) => ({ id, name, short, type })));
});
app.post('/api/orgs', auth('admin'), async (req, res) => {
  const { name, short, type, building } = req.body || {};
  if (!name || !type) return bad(res, 'Укажите название и тип');
  const r = await db.prepare('INSERT INTO organizations (tenant_id, name, short, type, building) VALUES (?,?,?,?,?)').run(T(req), name, short || name, type, building || '');
  // новое подразделение сразу получает виды отходов по отрасли компании
  const cfg = await REF.getSettings(T(req));
  await REF.applyIndustry(T(req), cfg.industry, Number(r.lastInsertRowid)).catch(() => {});
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/orgs/:id', auth('admin'), async (req, res) => {
  const o = await orgInTenant(req, req.params.id);
  if (!o) return bad(res, 'Не найдено', 404);
  const n = { ...o, ...req.body };
  await db.prepare('UPDATE organizations SET name=?, short=?, type=?, building=?, active=? WHERE id=?').run(n.name, n.short, n.type, n.building, n.active ? 1 : 0, o.id);
  res.json({ ok: true });
});
app.get('/api/orgs/:id/qr', auth(...STAFF), async (req, res) => {
  if (!(await orgInTenant(req, req.params.id))) return bad(res, 'Не найдено', 404);
  const url = `${publicUrl(req)}/app#/form?org=${+req.params.id}`;
  res.json({ url, dataUrl: await QRCode.toDataURL(url, { width: 360, margin: 1 }) });
});

// ---------- способы утилизации (общие для платформы) ----------
app.get('/api/methods', auth(), async (_req, res) => res.json(await db.prepare('SELECT * FROM disposal_methods ORDER BY rank, id').all()));
const co2In = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
app.post('/api/methods', auth('admin'), platformOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'Укажите название');
  try {
    const r = await db.prepare('INSERT INTO disposal_methods (code, name, is_recycling, co2_factor, rank, note) VALUES (?,?,?,?,?,?)')
      .run(b.code ? String(b.code).toUpperCase() : null, b.name.trim(), b.is_recycling ? 1 : 0, co2In(b.co2_factor), +b.rank || 5, b.note || null);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch { bad(res, 'Такой способ или код уже есть'); }
});
app.put('/api/methods/:id', auth('admin'), platformOnly, async (req, res) => {
  const m = await db.prepare('SELECT * FROM disposal_methods WHERE id=?').get(+req.params.id);
  if (!m) return bad(res, 'Не найдено', 404);
  const n = { ...m, ...req.body };
  await db.prepare('UPDATE disposal_methods SET name=?, is_recycling=?, co2_factor=?, rank=?, active=? WHERE id=?')
    .run(n.name, n.is_recycling ? 1 : 0, co2In(n.co2_factor), +n.rank || 5, n.active ? 1 : 0, m.id);
  res.json({ ok: true });
});

// ---------- настройки компании, справочники, отраслевые шаблоны ----------
app.get('/api/config', async (req, res) => res.json({ ...(await REF.getSettings(req.user?.tenant_id)), bot: BOT.state.username || null }));
app.put('/api/config', auth('admin'), async (req, res) => { await REF.setSettings(T(req), req.body || {}); res.json(await REF.getSettings(T(req))); });
app.post('/api/reference/import', auth('admin'), async (req, res) => {
  const m = /^data:[^;]*;base64,(.+)$/.exec(String(req.body?.file || ''));
  if (!m) return bad(res, 'Приложите файл .xlsx');
  if (req.body.org_id && !(await orgInTenant(req, req.body.org_id))) return bad(res, 'Подразделение не найдено');
  try {
    const parsed = await REF.parseWorkbook(Buffer.from(m[1], 'base64'));
    const stats = await REF.applyReference(parsed, { tenantId: T(req), orgId: req.body.org_id ? +req.body.org_id : null, withMethods: req.user.platform });
    res.json({ ...stats, typesInFile: parsed.types.length, methodsInFile: parsed.methods.length });
  } catch (e) { bad(res, 'Не удалось прочитать справочник: ' + e.message); }
});
app.post('/api/reference/industry', auth('admin'), async (req, res) => {
  if (req.body?.org_id && !(await orgInTenant(req, req.body.org_id))) return bad(res, 'Подразделение не найдено');
  try { res.json(await REF.applyIndustry(T(req), req.body?.industry, req.body?.org_id ? +req.body.org_id : null)); }
  catch (e) { bad(res, e.message); }
});

// ---------- виды отходов подразделений ----------
app.get('/api/waste-types', auth(), async (req, res) => {
  const all = req.query.all === '1' && STAFF.includes(req.user.role);
  const orgId = isEntry(req.user) ? req.user.org_id : (req.query.org ? +req.query.org : null);
  const where = all ? 'o.tenant_id = ?' : 'w.org_id = ? AND w.active = 1 AND o.tenant_id = ?';
  const rows = await db.prepare(`SELECT w.*, o.short org_short, m.name default_method, rm.name rec_name, rm.co2_factor rec_co2, rm.rank rec_rank,
      (SELECT COUNT(*) FROM entries e WHERE e.waste_type_id=w.id) used
    FROM waste_types w JOIN organizations o ON o.id=w.org_id LEFT JOIN disposal_methods m ON m.id=w.default_method_id
    LEFT JOIN disposal_methods rm ON rm.id=w.recommended_method_id
    WHERE ${where} ORDER BY w.org_id, w.id`).all(...(all ? [T(req)] : [orgId, T(req)]));
  res.json(rows);
});
app.post('/api/waste-types', auth('resp', 'reviewer', 'admin'), async (req, res) => {
  const b = req.body || {};
  const orgId = isEntry(req.user) ? req.user.org_id : (b.org_id && (await orgInTenant(req, b.org_id)) ? +b.org_id : null);
  if (!orgId) return bad(res, 'Выберите подразделение');
  const name = String(b.name || '').trim();
  if (!name) return bad(res, 'Укажите наименование отхода');
  if (!['кг', 'л'].includes(b.unit)) return bad(res, 'Единица: кг или л');
  if (await db.prepare('SELECT id FROM waste_types WHERE lower(name)=lower(?) AND org_id=? AND active=1').get(name, orgId)) return bad(res, 'Такой вид отхода уже есть в справочнике');
  const method = b.default_method_id ? +b.default_method_id : (await db.prepare('SELECT id FROM disposal_methods ORDER BY rank DESC, id LIMIT 1').get()).id;
  const category = ['organic', 'recyclable', 'special', 'mixed'].includes(b.category) ? b.category : 'organic';
  // коэффициент ТБО по умолчанию — по категории (DEFRA 2024): органика 0,70021; вторсырьё/смешанные — как картон
  const defCo2 = category === 'organic' || category === 'special' ? 0.70021 : 1.16439;
  const rec = b.recommended_method_id ? +b.recommended_method_id : null;
  const r = await db.prepare(`INSERT INTO waste_types (org_id, name, unit, kg_per_unit, category, default_method_id, recommended_method_id, recyclable, co2_factor, max_per_entry, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(orgId, name.slice(0, 120), b.unit, b.unit === 'л' ? 0.92 : 1, category, method, rec,
    Math.max(0, Math.min(2, b.recyclable === true ? 2 : +b.recyclable || 0)), b.co2_factor != null && b.co2_factor !== '' ? +b.co2_factor : defCo2, +b.max_per_entry || 200, req.user.id);
  res.json({ id: Number(r.lastInsertRowid) });
});
const typeInTenant = (req, id) => db.prepare('SELECT w.* FROM waste_types w JOIN organizations o ON o.id=w.org_id WHERE w.id=? AND o.tenant_id=?').get(+id, T(req));
app.put('/api/waste-types/:id', auth('reviewer', 'admin'), async (req, res) => {
  const w = await typeInTenant(req, req.params.id);
  if (!w) return bad(res, 'Не найдено', 404);
  const n = { ...w, ...req.body };
  await db.prepare('UPDATE waste_types SET name=?, unit=?, default_method_id=?, recommended_method_id=?, recyclable=?, co2_factor=?, max_per_entry=?, active=? WHERE id=?')
    .run(n.name, n.unit, +n.default_method_id, n.recommended_method_id ? +n.recommended_method_id : null, Math.max(0, Math.min(2, +n.recyclable || 0)),
      +n.co2_factor, +n.max_per_entry, n.active ? 1 : 0, w.id);
  res.json({ ok: true });
});
app.delete('/api/waste-types/:id', auth('admin'), async (req, res) => {
  const w = await typeInTenant(req, req.params.id);
  if (!w) return bad(res, 'Не найдено', 404);
  const used = (await db.prepare('SELECT COUNT(*) c FROM entries WHERE waste_type_id=?').get(w.id)).c;
  if (used) { await db.prepare('UPDATE waste_types SET active=0 WHERE id=?').run(w.id); return res.json({ ok: true, deactivated: true }); }
  await db.prepare('DELETE FROM waste_types WHERE id=?').run(w.id);
  res.json({ ok: true });
});

// ---------- пользователи и приглашения (администратор компании) ----------
async function checkRoleOrg(req, role, orgId) {
  if (!ACC.ROLES.includes(role)) return 'Неизвестная роль';
  if (role === 'resp' && !(await orgInTenant(req, orgId))) return 'Ответственное лицо должно быть привязано к подразделению';
  return null;
}
app.get('/api/users', auth('admin'), async (req, res) => res.json(await db.prepare(`SELECT u.id, u.full_name, u.email, u.role, u.org_id, u.active, u.created_at, o.short org_short,
  CASE WHEN u.tg_chat_id IS NULL THEN 0 ELSE 1 END tg
  FROM users u LEFT JOIN organizations o ON o.id=u.org_id WHERE u.tenant_id=? ORDER BY u.role, u.id`).all(T(req))));
app.post('/api/users', auth('admin'), async (req, res) => {
  const { full_name, email, password, role, org_id } = req.body || {};
  if (!full_name || !email || !password || !role) return bad(res, 'Заполните имя, e-mail, пароль и роль');
  const err = await checkRoleOrg(req, role, org_id); if (err) return bad(res, err);
  try { ACC.checkPasswordRules(password); } catch (e) { return accountErr(res, e); }
  const mail = String(email).trim().toLowerCase();
  if (await db.prepare('SELECT id FROM users WHERE lower(email)=?').get(mail)) return bad(res, 'Пользователь с таким e-mail уже есть');
  const r = await db.prepare('INSERT INTO users (tenant_id, full_name, email, pass_hash, role, org_id, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(T(req), String(full_name).trim(), mail, hashPassword(password), role, role === 'resp' ? +org_id : null, nowIso());
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/users/:id', auth('admin'), async (req, res) => {
  const u = await db.prepare('SELECT * FROM users WHERE id=? AND tenant_id=?').get(+req.params.id, T(req));
  if (!u) return bad(res, 'Не найдено', 404);
  const n = { ...u, ...req.body };
  const err = await checkRoleOrg(req, n.role, n.org_id); if (err) return bad(res, err);
  // не даём компании остаться без администратора
  if (u.role === 'admin' && (n.role !== 'admin' || !n.active)) {
    const admins = (await db.prepare("SELECT COUNT(*) c FROM users WHERE tenant_id=? AND role='admin' AND active=1").get(T(req))).c;
    if (admins <= 1) return bad(res, 'В компании должен остаться хотя бы один активный администратор');
  }
  if (req.body.password) { try { ACC.checkPasswordRules(req.body.password); } catch (e) { return accountErr(res, e); } }
  await db.prepare('UPDATE users SET full_name=?, role=?, org_id=?, active=? WHERE id=?').run(n.full_name, n.role, n.role === 'resp' ? +n.org_id : null, n.active ? 1 : 0, u.id);
  if (req.body.password) await db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(req.body.password), u.id);
  if (!n.active || req.body.password) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  res.json({ ok: true });
});
app.get('/api/invites', auth('admin'), async (req, res) => {
  const rows = await db.prepare(`SELECT i.id, i.code, i.role, i.expires_at, i.max_uses, i.uses, i.created_at, o.short org_short FROM invites i
    LEFT JOIN organizations o ON o.id=i.org_id WHERE i.tenant_id=? AND i.expires_at > ? AND i.uses < i.max_uses ORDER BY i.id DESC`).all(T(req), nowIso());
  res.json(rows.map((r) => ({ ...r, url: `${publicUrl(req)}/app#/join?code=${r.code}`, role_ru: ACC.ROLE_RU[r.role] })));
});
app.post('/api/invites', auth('admin'), async (req, res) => {
  try {
    const r = await ACC.createInvite(req.user, req.body || {});
    const url = `${publicUrl(req)}/app#/join?code=${r.code}`;
    res.json({ ...r, url, qr: await QRCode.toDataURL(url, { width: 320, margin: 1 }) });
  } catch (e) { accountErr(res, e); }
});
app.delete('/api/invites/:id', auth('admin'), async (req, res) => {
  await db.prepare('DELETE FROM invites WHERE id=? AND tenant_id=?').run(+req.params.id, T(req));
  res.json({ ok: true });
});

// ---------- отчёты ----------
async function getOrCreateReport(orgId, period) {
  let r = await db.prepare('SELECT * FROM reports WHERE org_id=? AND period=?').get(orgId, period);
  if (!r) {
    await db.prepare('INSERT INTO reports (org_id, period) VALUES (?,?) ON CONFLICT (org_id, period) DO NOTHING').run(orgId, period);
    r = await db.prepare('SELECT * FROM reports WHERE org_id=? AND period=?').get(orgId, period);
  }
  return r;
}
async function setStatus(rep, to, user, comment) {
  await db.tx(async () => {
    await db.prepare(`UPDATE reports SET status=?, last_comment=COALESCE(?, last_comment),
        submitted_at=CASE WHEN ?='submitted' THEN ? ELSE submitted_at END,
        reviewer_id=CASE WHEN ? IN ('in_review','accepted','returned') THEN ? ELSE reviewer_id END,
        decided_at=CASE WHEN ? IN ('accepted','returned') THEN ? ELSE decided_at END WHERE id=?`)
      .run(to, comment || null, to, nowIso(), to, user.id, to, nowIso(), rep.id);
    await db.prepare('INSERT INTO status_history (report_id, from_status, to_status, user_id, comment, at) VALUES (?,?,?,?,?,?)')
      .run(rep.id, rep.status, to, user.id, comment || null, nowIso());
  });
}

async function reportFull(id) {
  const rep = await db.prepare(`SELECT r.*, o.name org_name, o.short org_short, o.type org_type, o.tenant_id, u.full_name reviewer_name
    FROM reports r JOIN organizations o ON o.id=r.org_id LEFT JOIN users u ON u.id=r.reviewer_id WHERE r.id=?`).get(id);
  if (!rep) return null;
  const entries = await A.registryRows({ reportId: id, statuses: Object.keys(STATUS_RU) });
  // итоги за день и за месяц по видам (вычисляются, не хранятся)
  const byType = {}; const byDay = {};
  for (const e of entries) {
    byType[e.type_name] ??= { name: e.type_name, unit: e.unit, qty: 0, kg: 0, recyclable: e.recyclable };
    byType[e.type_name].qty += e.qty; byType[e.type_name].kg += e.kg;
    byDay[e.date] ??= { date: e.date, kg: 0, items: {} };
    byDay[e.date].kg += e.kg;
    byDay[e.date].items[e.type_name] = (byDay[e.date].items[e.type_name] || 0) + e.qty;
  }
  const history = await db.prepare(`SELECT h.*, u.full_name user_name, u.role user_role FROM status_history h JOIN users u ON u.id=h.user_id
    WHERE report_id=? ORDER BY h.id`).all(id);
  return {
    ...rep, status_ru: STATUS_RU[rep.status], editable: EDITABLE.includes(rep.status), entries,
    totals: { byType: Object.values(byType).map((t) => ({ ...t, qty: Math.round(t.qty * 100) / 100, kg: Math.round(t.kg * 10) / 10 })).sort((a, b) => b.kg - a.kg),
      byDay: Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date)), kg: Math.round(entries.reduce((a, e) => a + e.kg, 0) * 10) / 10 },
    history: history.map((h) => ({ ...h, from_ru: STATUS_RU[h.from_status] || '—', to_ru: STATUS_RU[h.to_status] })),
  };
}

app.get('/api/reports', auth(), async (req, res) => {
  const where = ['o.tenant_id=?']; const p = [T(req)];
  if (isEntry(req.user)) { where.push('r.org_id=?'); p.push(req.user.org_id); }
  else if (req.query.org) { where.push('r.org_id=?'); p.push(+req.query.org); }
  if (req.query.status) { where.push('r.status=?'); p.push(req.query.status); }
  if (req.query.period) { where.push('r.period=?'); p.push(req.query.period); }
  const rows = await db.prepare(`SELECT r.*, o.short org_short, o.name org_name,
      (SELECT COUNT(*) FROM entries e WHERE e.report_id=r.id) n,
      (SELECT ROUND(CAST(SUM(e.qty*w.kg_per_unit) AS NUMERIC),1) FROM entries e JOIN waste_types w ON w.id=e.waste_type_id WHERE e.report_id=r.id) kg
    FROM reports r JOIN organizations o ON o.id=r.org_id WHERE ${where.join(' AND ')}
    ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'in_review' THEN 1 WHEN 'returned' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, r.period DESC, o.id`).all(...p);
  res.json(rows.map((r) => ({ ...r, status_ru: STATUS_RU[r.status] })));
});

// текущий отчёт ответственного/личного пользователя (черновик за месяц создаётся автоматически)
app.get('/api/my-report', auth('resp'), async (req, res) => {
  const cur = A.today().slice(0, 7);
  let period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : cur;
  if (period > cur || period < A.minPeriod()) period = cur;
  const rep = req.user.demo ? await db.prepare('SELECT * FROM reports WHERE org_id=? AND period=?').get(req.user.org_id, period) : await getOrCreateReport(req.user.org_id, period);
  if (!rep) return res.json({ id: 0, period, status: 'draft', status_ru: STATUS_RU.draft, editable: false, entries: [], totals: { kg: 0, byType: [], byDay: [] }, history: [] });
  res.json(await reportFull(rep.id));
});

app.get('/api/reports/:id', auth(), async (req, res) => {
  const rep = await reportInTenant(req, req.params.id);
  if (!rep) return bad(res, 'Отчёт не найден', 404);
  // проверяющий открыл отправленный отчёт -> «на проверке»
  if (req.user.role === 'reviewer' && rep.status === 'submitted' && !req.user.demo) await setStatus(rep, 'in_review', req.user, null);
  const full = await reportFull(rep.id);
  if (STAFF.includes(req.user.role)) full.checks = await A.reportChecks(rep.id);
  res.json(full);
});

app.post('/api/reports/:id/submit', auth('resp'), async (req, res) => {
  if (req.user.role === 'personal') return bad(res, 'В личном аккаунте отчёты не отправляются на проверку');
  const rep = await reportInTenant(req, req.params.id);
  if (!rep) return bad(res, 'Отчёт не найден', 404);
  if (!EDITABLE.includes(rep.status)) return bad(res, `Отчёт в статусе «${STATUS_RU[rep.status]}» — отправить нельзя`);
  if (!(await db.prepare('SELECT COUNT(*) c FROM entries WHERE report_id=?').get(rep.id)).c) return bad(res, 'В отчёте нет записей');
  await setStatus(rep, 'submitted', req.user, req.body?.comment || null);
  res.json(await reportFull(rep.id));
});
app.post('/api/reports/:id/accept', auth('reviewer', 'admin'), async (req, res) => {
  const rep = await reportInTenant(req, req.params.id);
  if (!rep) return bad(res, 'Отчёт не найден', 404);
  if (!['submitted', 'in_review'].includes(rep.status)) return bad(res, 'Принять можно только отправленный отчёт');
  await setStatus(rep, 'accepted', req.user, req.body?.comment || null);
  BOT.notifyReport(rep.id, 'accepted');
  res.json(await reportFull(rep.id));
});
app.post('/api/reports/:id/return', auth('reviewer', 'admin'), async (req, res) => {
  const rep = await reportInTenant(req, req.params.id);
  if (!rep) return bad(res, 'Отчёт не найден', 404);
  const comment = String(req.body?.comment || '').trim();
  if (!comment) return bad(res, 'При возврате комментарий обязателен');
  if (!['submitted', 'in_review'].includes(rep.status)) return bad(res, 'Вернуть можно только отправленный отчёт');
  await setStatus(rep, 'returned', req.user, comment);
  BOT.notifyReport(rep.id, 'returned', comment);
  res.json(await reportFull(rep.id));
});

// ---------- записи (взвешивания) ----------
function savePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 4.5 * 1024 * 1024) return null;
  const name = `${crypto.randomBytes(10).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOADS, name), buf);
  return name;
}
async function validateEntry(user, b) {
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Укажите дату';
  if (date > A.today()) return 'Дата не может быть в будущем';
  if (date.slice(0, 7) < A.minPeriod()) return 'Можно вносить записи не старше 12 месяцев';
  const qty = Number(String(b.qty).replace(',', '.'));
  if (!(qty > 0)) return 'Вес/объём должен быть больше 0';
  const w = await db.prepare('SELECT * FROM waste_types WHERE id=? AND active=1 AND org_id=?').get(+b.waste_type_id, user.org_id);
  if (!w) return 'Выберите вид отхода из списка';
  if (qty > w.max_per_entry) return `Значение ${qty} ${w.unit} выше разумного предела (${w.max_per_entry} ${w.unit}) для «${w.name}». Проверьте ввод`;
  if (!(await db.prepare('SELECT id FROM disposal_methods WHERE id=? AND active=1').get(+b.method_id))) return 'Выберите способ утилизации';
  return { date, qty, w };
}
// фото, загруженное для распознавания, можно один раз привязать к записи (не загружая повторно)
const photoRefs = new Map(); // name -> { userId, at }
function takePhotoRef(user, name) {
  const r = name && photoRefs.get(String(name));
  if (!r || r.userId !== user.id || Date.now() - r.at > 3600e3) return null;
  return String(name);
}
setInterval(() => { for (const [k, v] of photoRefs) if (Date.now() - v.at > 3600e3) photoRefs.delete(k); }, 15 * 60e3).unref();
app.post('/api/entries', auth('resp'), async (req, res) => {
  // офлайн-очередь: client_id — защита от повторной отправки той же записи
  const clientId = req.body?.client_id ? String(req.body.client_id).slice(0, 64) : null;
  if (clientId) {
    const ex = await db.prepare('SELECT e.id, e.report_id FROM entries e WHERE e.client_id=? AND e.user_id=?').get(clientId, req.user.id);
    if (ex) return res.json({ id: ex.id, duplicate: true, report: await reportFull(ex.report_id) });
  }
  const v = await validateEntry(req.user, req.body || {});
  if (typeof v === 'string') return bad(res, v);
  const rep = await getOrCreateReport(req.user.org_id, v.date.slice(0, 7));
  if (!EDITABLE.includes(rep.status)) return bad(res, `Отчёт за ${A.monthFull(rep.period)} в статусе «${STATUS_RU[rep.status]}» — добавление записей заблокировано`);
  if (!req.body.force) {
    const dup = await db.prepare('SELECT id FROM entries WHERE report_id=? AND date=? AND waste_type_id=? AND qty=?').get(rep.id, v.date, v.w.id, v.qty);
    if (dup) return bad(res, `Похоже на дубль: «${v.w.name}» ${v.qty} ${v.w.unit} за эту дату уже внесено. Сохранить всё равно?`, 409, { duplicate: true });
  }
  const photo = takePhotoRef(req.user, req.body.photo_ref) || savePhoto(req.body.photo);
  const source = ['manual', 'voice', 'photo', 'offline'].includes(req.body.source) ? req.body.source : 'manual';
  const prod = req.body.product_id ? await db.prepare('SELECT id FROM products WHERE id=?').get(+req.body.product_id) : null;
  const r = await db.prepare('INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, photo, note, created_at, source, product_id, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(rep.id, v.date, v.w.id, v.qty, +req.body.method_id, req.user.id, photo, req.body.note ? String(req.body.note).slice(0, 500) : null, nowIso(), source, prod ? prod.id : null, clientId);
  res.json({ id: Number(r.lastInsertRowid), report: await reportFull(rep.id) });
});
async function ownEditableEntry(req, res) {
  const e = await db.prepare('SELECT e.*, r.org_id, r.status FROM entries e JOIN reports r ON r.id=e.report_id WHERE e.id=?').get(+req.params.id);
  if (!e || e.org_id !== req.user.org_id) { bad(res, 'Запись не найдена', 404); return null; }
  if (!EDITABLE.includes(e.status)) { bad(res, 'Отчёт уже отправлен или принят — запись заблокирована'); return null; }
  return e;
}
app.put('/api/entries/:id', auth('resp'), async (req, res) => {
  const e = await ownEditableEntry(req, res); if (!e) return;
  const v = await validateEntry(req.user, { ...e, ...req.body });
  if (typeof v === 'string') return bad(res, v);
  if (v.date.slice(0, 7) !== e.date.slice(0, 7)) return bad(res, 'Перенос записи в другой месяц невозможен — удалите и внесите заново');
  const pid = req.body.product_id === undefined ? e.product_id : (req.body.product_id ? +req.body.product_id : null);
  await db.prepare('UPDATE entries SET date=?, waste_type_id=?, qty=?, method_id=?, product_id=? WHERE id=?').run(v.date, v.w.id, v.qty, +(req.body.method_id ?? e.method_id), pid, e.id);
  res.json({ ok: true, report: await reportFull(e.report_id) });
});
app.delete('/api/entries/:id', auth('resp'), async (req, res) => {
  const e = await ownEditableEntry(req, res); if (!e) return;
  await db.prepare('DELETE FROM entries WHERE id=?').run(e.id);
  res.json({ ok: true, report: await reportFull(e.report_id) });
});
app.get('/api/photo/:name', auth(), async (req, res) => {
  const name = path.basename(req.params.name);
  const e = await db.prepare('SELECT r.org_id, o.tenant_id FROM entries e JOIN reports r ON r.id=e.report_id JOIN organizations o ON o.id=r.org_id WHERE e.photo=?').get(name);
  if (!e || e.tenant_id !== T(req) || (isEntry(req.user) && e.org_id !== req.user.org_id)) return res.status(404).end();
  res.sendFile(path.join(UPLOADS, name));
});

// ---------- реестр, сводка, аналитика ----------
const regRows = (req) => { const q = req.query; return A.registryRows({ tenantId: T(req), from: q.from, to: q.to, orgId: q.org, typeName: q.type, methodId: q.method }); };
app.get('/api/registry', auth(...STAFF), async (req, res) => {
  const rows = await regRows(req);
  const kg = rows.reduce((a, r) => a + r.kg, 0);
  res.json({ total: rows.length, kg: Math.round(kg * 10) / 10, co2: Math.round(rows.reduce((a, r) => a + r.co2, 0) * 10) / 10,
    rows: rows.slice(0, 1000).map(({ id, date, org_short, type_name, qty, unit, method_name, user_name, period, photo }) => ({ id, date, org_short, type_name, qty, unit, method_name, user_name, period, photo })) });
});
const fname = (s) => encodeURIComponent(s);
app.get('/api/registry.xlsx', auth(...STAFF), async (req, res) => {
  const rows = await regRows(req);
  const sub = `Единый реестр (принятые отчёты) · ${req.query.from || 'начало'} — ${req.query.to || A.today()} · записей ${rows.length}`;
  const buf = await buildEntriesXlsx(rows, { title: 'Реестр пищевых отходов — выгрузка по фильтру', sub });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname(`Реестр_${req.query.from || ''}_${req.query.to || A.today()}.xlsx`)}`);
  res.send(Buffer.from(buf));
});
app.get('/api/registry.csv', auth(...STAFF), async (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname(`registry_${req.query.from || ''}_${req.query.to || A.today()}.csv`)}`);
  res.send(buildEntriesCsv(await regRows(req)));
});
// «Моя сводка»: сегодня, неделя к прошлой, месяц, график 7 дней (+ цель и место в рейтинге у компании)
app.get('/api/my-summary', auth('resp'), async (req, res) => {
  const t = A.today();
  const strip = ({ rows, ...x }) => x;
  const orgId = req.user.org_id;
  const [week, month, today] = await Promise.all([
    A.periodStats({ orgId, ...A.namedPeriod('week') }), A.periodStats({ orgId, ...A.namedPeriod('month') }), A.periodStats({ orgId, from: t, to: t })]);
  const rep = req.user.demo ? (await db.prepare('SELECT * FROM reports WHERE org_id=? AND period=?').get(orgId, t.slice(0, 7))) || { id: 0, status: 'draft', period: t.slice(0, 7) }
    : await getOrCreateReport(orgId, t.slice(0, 7));
  const out = { today: strip(today), week: strip(week), month: strip(month),
    report: { id: rep.id, status: rep.status, status_ru: STATUS_RU[rep.status], period: rep.period, last_comment: rep.last_comment } };
  // цель: меньше выбрасывать к своим прошлым 3 месяцам; в компании — ещё и место в рейтинге подразделений
  const rt = await GOALS.rating(T(req));
  const mine = rt.rows.find((r) => r.org_id === orgId);
  out.goal = mine ? { ...mine, of: rt.rows.length } : null;
  // потери в деньгах: по цене продукта из справочника, если он указан, иначе ≈ 900 ₸/кг для органики (допущение)
  out.month.kzt = Math.round(month.rows.filter((r) => r.category === 'organic').reduce((a, r) => a + r.kg * (r.price_kzt_kg || 900), 0));
  res.json(out);
});

// ---------- цели и рейтинг подразделений ----------
app.get('/api/rating', auth(), async (req, res) => {
  const p = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : undefined;
  res.json({ ...(await GOALS.rating(T(req), p)), myOrg: req.user.org_id || null });
});
app.put('/api/goals/:orgId', auth('reviewer', 'admin', 'personal'), async (req, res) => {
  if (!(await orgInTenant(req, req.params.orgId))) return bad(res, 'Подразделение не найдено', 404);
  res.json(await GOALS.setGoal(+req.params.orgId, req.body || {}, req.user.id));
});
app.get('/api/my-report.xlsx', auth('resp'), async (req, res) => {
  const p = A.namedPeriod(['week', 'month', 'quarter', 'prev_month'].includes(req.query.p) ? req.query.p : 'month');
  const st = await A.periodStats({ orgId: req.user.org_id, ...p });
  const buf = await buildEntriesXlsx(st.rows, { title: `Журнал учёта пищевых отходов — ${req.user.org_name}`, sub: `${p.label}: ${p.from} — ${p.to} · ${st.kg} кг · все статусы отчёта` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname(`${req.user.org_short}_${p.from}_${p.to}.xlsx`)}`);
  res.send(Buffer.from(buf));
});

function periodParams(q) {
  const kind = ['month', 'quarter', 'year'].includes(q.kind) ? q.kind : 'quarter';
  let value = q.value;
  const t = A.today();
  if (!value) value = kind === 'month' ? t.slice(0, 7) : kind === 'year' ? t.slice(0, 4) : `${t.slice(0, 4)}-Q${Math.ceil(+t.slice(5, 7) / 3)}`;
  return { kind, value };
}
app.get('/api/summary', auth(...STAFF), async (req, res) => {
  const { kind, value } = periodParams(req.query);
  const s = await A.summary(T(req), kind, value); delete s.rows;
  res.json(s);
});
app.get('/api/summary.xlsx', auth(...STAFF), async (req, res) => {
  const { kind, value } = periodParams(req.query);
  const s = await A.summary(T(req), kind, value);
  s.company = (await REF.getSettings(T(req))).company;
  s.conclusion = await AI.conclusion(AI.factsFrom(s.label, { ...s, rows: undefined }));
  const buf = await buildSummaryXlsx(s);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="waste_report_${value}.xlsx"`);
  res.send(Buffer.from(buf));
});

app.get('/api/dashboard', auth(), async (req, res) => {
  const t = A.today();
  const to = req.query.to || t;
  let from = req.query.from;
  if (!from) { const d = new Date(t.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 5); from = d.toISOString().slice(0, 10); }
  const orgId = isEntry(req.user) ? req.user.org_id : (req.query.org || null);
  // у личного аккаунта нет проверки отчётов — аналитика по всем своим записям
  res.json(await A.dashboard({ tenantId: T(req), from, to, orgId, statuses: req.user.role === 'personal' ? A.ALL_ST : undefined }));
});

app.get('/api/missing', auth(...STAFF), async (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : A.today().slice(0, 7);
  res.json({ period, label: A.monthFull(period), orgs: (await A.missingReports(T(req), period)).map((o) => ({ ...o, status_ru: STATUS_RU[o.status] || o.status })) });
});

// ---------- Telegram ----------
app.get('/api/telegram/status', auth(), async (req, res) => {
  const u = await db.prepare('SELECT tg_chat_id FROM users WHERE id=?').get(req.user.id);
  res.json({ enabled: BOT.state.enabled, username: BOT.state.username, error: BOT.state.error || null, linked: !!u.tg_chat_id });
});
app.post('/api/telegram/link', auth(), async (req, res) => {
  if (!BOT.state.username) return bad(res, BOT.state.enabled ? 'Бот ещё запускается или нет связи с Telegram' : 'Бот не подключён на сервере (TELEGRAM_BOT_TOKEN)');
  const code = crypto.randomBytes(9).toString('base64url');
  await db.prepare('DELETE FROM tg_links WHERE user_id=?').run(req.user.id);
  await db.prepare('INSERT INTO tg_links (code, user_id, expires_at) VALUES (?,?,?)').run(code, req.user.id, new Date(Date.now() + 15 * 60e3).toISOString());
  res.json({ url: `https://t.me/${BOT.state.username}?start=${code}`, username: BOT.state.username });
});
// Проверка подписи Telegram: initData мини-приложения (HMAC-SHA256 с токеном бота)
function verifyInitData(initData) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash'); params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!hash || hash.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(calc))) return null;
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 24 * 3600) return null;
  try { return JSON.parse(params.get('user') || '{}'); } catch { return null; }
}
// Вход из мини-приложения: привязанный Telegram — сразу в аккаунт; иначе по желанию создаём личный аккаунт
app.post('/api/telegram/webapp-login', async (req, res) => {
  const tgUser = verifyInitData(String(req.body?.initData || ''));
  if (!tgUser?.id) return bad(res, 'Подпись Telegram не прошла проверку или устарела — откройте приложение заново', 401);
  let u = await db.prepare('SELECT id FROM users WHERE tg_chat_id=? AND active=1').get(String(tgUser.id));
  if (!u && req.body?.createPersonal) {
    try {
      const r = await ACC.createPersonal({ full_name: [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || tgUser.username, lang: tgUser.language_code === 'kk' ? 'kz' : 'ru' }, { viaTelegram: tgUser.id });
      u = { id: r.userId };
    } catch (e) { return accountErr(res, e); }
  }
  if (!u) return bad(res, 'Этот Telegram ещё не привязан к аккаунту.', 403, { needLink: true, tgName: tgUser.first_name || '' });
  await startSession(res, u.id, req);
  res.json({ ok: true });
});
app.post('/api/telegram/unlink', auth(), async (req, res) => {
  const u = await db.prepare('SELECT email FROM users WHERE id=?').get(req.user.id);
  if (/@telegram\.wasteless$/.test(u.email)) return bad(res, 'Сначала задайте e-mail и пароль в профиле — иначе в аккаунт будет не войти');
  await db.prepare('UPDATE users SET tg_chat_id=NULL WHERE id=?').run(req.user.id); res.json({ ok: true });
});

// ---------- ИИ ----------
app.get('/api/ai/status', auth(), (_req, res) => res.json({ enabled: AI.enabled(), model: AI.MODEL }));
const orgTypes = (orgId) => db.prepare('SELECT id, name, unit, category, default_method_id FROM waste_types WHERE org_id=? AND active=1').all(orgId);
const withNames = (items, types) => items.map((x) => { const t = types.find((y) => y.id === x.waste_type_id); return { ...x, name: t.name, unit: t.unit, method_id: t.default_method_id }; });
app.post('/api/ai/parse', auth('resp'), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return bad(res, 'Скажите или напишите, что взвесили');
  const types = await orgTypes(req.user.org_id);
  const r = await AI.parse(text, types);
  res.json({ ...r, items: withNames(r.items, types) });
});
// распознавание по фото: продукт/вид и вес (табло весов или оценка); фото сохраняется и привязывается к записям
app.post('/api/ai/photo', auth('resp'), async (req, res) => {
  const name = savePhoto(req.body?.photo);
  if (!name) return bad(res, 'Приложите фото (JPEG/PNG, до 4 МБ)');
  photoRefs.set(name, { userId: req.user.id, at: Date.now() });
  const types = await orgTypes(req.user.org_id);
  try {
    const r = await AI.photo(req.body.photo, types);
    res.json({ ...r, items: withNames(r.items, types), photo_ref: name });
  } catch (e) { bad(res, e.message); }
});
app.get('/api/ai/conclusion', auth(), async (req, res) => {
  let facts;
  if (req.query.kind) {
    if (isEntry(req.user)) return bad(res, 'Недостаточно прав', 403);
    const { kind, value } = periodParams(req.query);
    const s = await A.summary(T(req), kind, value); delete s.rows;
    facts = AI.factsFrom(s.label, s);
  } else {
    const t = A.today(); const from = req.query.from || `${t.slice(0, 7)}-01`; const to = req.query.to || t;
    const orgId = isEntry(req.user) ? req.user.org_id : (req.query.org || null);
    const d = await A.dashboard({ tenantId: T(req), from, to, orgId });
    facts = AI.factsFrom(`${from} — ${to}${orgId ? ', ' + (d.orgs[0] || '') : ', все подразделения'}`, d);
  }
  res.json(await AI.conclusion(facts));
});

// ---------- справочник продуктов (общий датасет платформы) ----------
app.get('/api/products', auth(), async (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'admin';
  const rows = await PROD.list(all);
  const used = Object.fromEntries((await db.prepare(`SELECT e.product_id, COUNT(*) n FROM entries e JOIN reports r ON r.id=e.report_id JOIN organizations o ON o.id=r.org_id
    WHERE e.product_id IS NOT NULL AND o.tenant_id=? GROUP BY e.product_id`).all(T(req))).map((r) => [r.product_id, r.n]));
  // для ответственного/личного — сразу вид отхода его подразделения, куда попадёт продукт
  const types = req.user.org_id ? await orgTypes(req.user.org_id) : null;
  res.json({ kinds: Object.fromEntries(Object.entries(PROD.KINDS).map(([k, v]) => [k, v.label])), canEdit: !!req.user.platform,
    products: rows.map((p) => ({ ...p, used: used[p.id] || 0, ...(types ? { type_id: PROD.typeFor(p, types)?.id || null } : {}) })) });
});
app.post('/api/products', auth('admin'), platformOnly, async (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return bad(res, 'Укажите название продукта');
  res.json(await PROD.importRows([b]));
});
app.put('/api/products/:id', auth('admin'), platformOnly, async (req, res) => {
  const p = await db.prepare('SELECT * FROM products WHERE id=?').get(+req.params.id);
  if (!p) return bad(res, 'Продукт не найден', 404);
  const b = { ...p, ...req.body };
  await db.prepare('UPDATE products SET name_kz=?, synonyms=?, kind=?, price_kzt_kg=?, active=?, updated_at=? WHERE id=?')
    .run(b.name_kz || null, String(b.synonyms || ''), PROD.KINDS[b.kind] ? b.kind : p.kind, Number(b.price_kzt_kg) || 0, b.active ? 1 : 0, nowIso(), p.id);
  res.json({ ok: true });
});
app.post('/api/products/import', auth('admin'), platformOnly, async (req, res) => {
  const m = /^data:([^;]*);base64,(.+)$/.exec(String(req.body?.file || ''));
  if (!m) return bad(res, 'Приложите файл .csv или .xlsx');
  const buf = Buffer.from(m[2], 'base64');
  try {
    let rows;
    if (/sheet|excel|xlsx/.test(m[1]) || buf.slice(0, 2).toString() === 'PK') {
      const ExcelJS = require('exceljs'); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
      const ws = wb.worksheets[0]; const head = ws.getRow(1).values.slice(1).map((h) => String(h || '').toLowerCase().trim());
      rows = []; ws.eachRow((r, i) => { if (i > 1) rows.push(Object.fromEntries(head.map((h, j) => [h, String(r.values[j + 1]?.text ?? r.values[j + 1] ?? '')]))); });
    } else rows = PROD.parseCsv(buf.toString('utf8'));
    if (!rows.length || !('name' in rows[0])) return bad(res, 'Нужен столбец name (и по желанию name_kz, synonyms, kind, price_kzt_kg)');
    res.json(await PROD.importRows(rows));
  } catch (e) { bad(res, 'Не удалось прочитать файл: ' + e.message); }
});
app.get('/api/products.csv', auth('admin'), async (_req, res) => {
  const rows = await PROD.list(true);
  const csv = '﻿name;name_kz;synonyms;kind;price_kzt_kg\n' + rows.map((p) => [p.name, p.name_kz || '', p.synonyms, p.kind, p.price_kzt_kg].join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="products.csv"'); res.send(csv);
});

// ---------- Электронные весы ----------
// Устройство шлёт: POST /api/scale/entries, заголовок X-Device-Token, тело {waste_type_id | waste_type, weight_kg}
async function scaleInsert(orgId, b) {
  const t = b.waste_type_id
    ? await db.prepare('SELECT * FROM waste_types WHERE id=? AND org_id=? AND active=1').get(+b.waste_type_id, orgId)
    : await db.prepare('SELECT * FROM waste_types WHERE lower(name)=lower(?) AND org_id=? AND active=1').get(String(b.waste_type || ''), orgId);
  if (!t) return { error: 'Вид отхода не найден в справочнике подразделения' };
  const kg = Number(b.weight_kg);
  if (!(kg > 0) || kg > t.max_per_entry * t.kg_per_unit) return { error: 'Недопустимый вес' };
  const date = A.today();
  const rep = await getOrCreateReport(orgId, date.slice(0, 7));
  if (!EDITABLE.includes(rep.status)) return { error: `Отчёт за период в статусе «${STATUS_RU[rep.status]}» — запись заблокирована` };
  const resp = await db.prepare("SELECT id FROM users WHERE org_id=? AND role IN ('resp','personal') AND active=1 ORDER BY id LIMIT 1").get(orgId);
  if (!resp) return { error: 'У подразделения нет ответственного лица' };
  const qty = Math.round((kg / t.kg_per_unit) * 100) / 100;
  const id = Number((await db.prepare("INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, created_at, source, note) VALUES (?,?,?,?,?,?,?,'scale',?)")
    .run(rep.id, date, t.id, qty, t.default_method_id, resp.id, nowIso(), b.device || 'весы')).lastInsertRowid);
  return { id, report_id: rep.id, waste_type: t.name, qty, unit: t.unit };
}
app.post('/api/scale/entries', async (req, res) => {
  const token = String(req.headers['x-device-token'] || '');
  const dev = token && await db.prepare('SELECT d.* FROM scale_devices d JOIN organizations o ON o.id=d.org_id JOIN tenants t ON t.id=o.tenant_id WHERE d.token_hash=? AND d.active=1 AND t.kind <> ?')
    .get(crypto.createHash('sha256').update(token).digest('hex'), 'demo');
  if (!dev) return bad(res, 'Неизвестное устройство', 401);
  const r = await scaleInsert(dev.org_id, { ...req.body, device: dev.name });
  if (r.error) return bad(res, r.error);
  res.json(r);
});
// эмулятор весов: ответственное лицо «кладёт отход на весы» выбранного вида
app.post('/api/scale/emulate', auth('resp'), async (req, res) => {
  const t = await db.prepare('SELECT * FROM waste_types WHERE id=? AND org_id=?').get(+req.body?.waste_type_id, req.user.org_id);
  if (!t) return bad(res, 'Выберите вид отхода');
  const kg = Math.round((Math.max(0.3, t.max_per_entry * 0.04) * (0.6 + Math.random() * 0.8)) * 10) / 10;
  const r = await scaleInsert(req.user.org_id, { waste_type_id: t.id, weight_kg: kg, device: 'Весы (эмулятор)' });
  if (r.error) return bad(res, r.error);
  res.json({ ...r, report: await reportFull(r.report_id) });
});
app.get('/api/scale/devices', auth('admin'), async (req, res) => res.json(await db.prepare(`SELECT d.id, d.name, d.token_hint, d.active, o.short org_short
  FROM scale_devices d JOIN organizations o ON o.id=d.org_id WHERE o.tenant_id=? ORDER BY d.id`).all(T(req))));
app.post('/api/scale/devices', auth('admin'), async (req, res) => {
  const org = await orgInTenant(req, req.body?.org_id);
  if (!org) return bad(res, 'Укажите подразделение');
  const token = 'dev_' + crypto.randomBytes(18).toString('hex');
  await db.prepare('INSERT INTO scale_devices (org_id, name, token_hash, token_hint) VALUES (?,?,?,?)')
    .run(org.id, req.body.name || `Весы · ${org.short}`, crypto.createHash('sha256').update(token).digest('hex'), token.slice(0, 8) + '…');
  res.json({ token }); // показывается один раз
});

// ---------- производство и прогноз «сколько готовить» ----------
const isoDate = (v, def) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : def);
app.get('/api/forecast', auth(), async (req, res) => {
  const orgId = await orgParam(req);
  if (!orgId) return bad(res, 'Выберите подразделение');
  let date = isoDate(req.query.date, FC.addDays(A.today(), 1));
  let f = await FC.forecast(orgId, date);
  // без явной даты: если завтра выходной — показываем ближайший рабочий день
  for (let k = 0; !req.query.date && f.closed && k < 6; k++) { date = FC.addDays(date, 1); f = await FC.forecast(orgId, date); }
  res.json({ ...f, track: await FC.track(orgId, A.today()) });
});
app.get('/api/production', auth(), async (req, res) => {
  const orgId = await orgParam(req);
  if (!orgId) return bad(res, 'Выберите подразделение');
  const date = isoDate(req.query.date, A.today());
  const usual = await db.prepare(`SELECT pr.id product_id, pr.name, pr.name_kz, COUNT(*) n FROM production p JOIN products pr ON pr.id=p.product_id
    WHERE p.org_id=? AND p.date >= ? GROUP BY pr.id, pr.name, pr.name_kz ORDER BY n DESC, pr.name`).all(orgId, FC.addDays(date, -42));
  res.json({ date, rows: await FC.dayRows(orgId, date), usual });
});
app.post('/api/production', auth('resp'), async (req, res) => {
  const date = isoDate(req.body?.date, null);
  if (!date) return bad(res, 'Укажите дату');
  if (date > A.today()) return bad(res, 'Дата не может быть в будущем');
  if (date < FC.addDays(A.today(), -14)) return bad(res, 'Итог дня можно внести не позже чем через 14 дней');
  try { res.json({ saved: await db.tx(() => FC.saveDay(req.user.org_id, req.user.id, date, Array.isArray(req.body.items) ? req.body.items : [])) }); }
  catch (e) { bad(res, e.message); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
// общий обработчик ошибок: в ответ — без подробностей, подробности — в лог
app.use((err, req, res, _next) => {
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Внутренняя ошибка сервера. Попробуйте ещё раз.' });
});

(async () => {
  if (process.env.RAILWAY_ENVIRONMENT && db.kind !== 'postgres') {
    console.warn('⚠️  DATABASE_URL не задан: на Railway база SQLite стирается при каждом деплое. Подключите PostgreSQL (Railway → New → Database → PostgreSQL) и переменную DATABASE_URL.');
  }
  await init();
  const SEED = require('./seed');
  await SEED.seedPlatform();
  // демо-компания (только чтение): создаётся при первом запуске; NO_DEMO=1 — без демо
  if (!process.env.NO_DEMO) {
    const tid = await SEED.seed();
    if (!process.env.NO_DEMO_PRODUCTION) { const n = await FC.seedDemo(tid, A.today()); if (n) console.log(`Демо-история производства: ${n} строк`); }
  }
  BOT = require('./telegram').start({ db, A, AI, PROD, ACC, savePhoto, getOrCreateReport, reportFull, setStatus, validateEntry, EDITABLE, STATUS_RU, nowIso,
    buildEntriesXlsx, buildSummaryXlsx, publicUrl: () => process.env.PUBLIC_URL || lanUrl() });
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Wasteless: http://localhost:${PORT} · база: ${db.kind}`);
    console.log(`Со смартфона в той же сети: ${lanUrl()}`);
  });
})().catch((e) => { console.error('Не удалось запустить сервер:', e); process.exit(1); });
