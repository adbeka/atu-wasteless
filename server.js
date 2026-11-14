// Цифровая система управления пищевыми отходами АО «АТУ» — сервер
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
const { db, hashPassword, checkPassword, nowIso } = require('./db');
const A = require('./analytics');
const { buildSummaryXlsx, buildEntriesXlsx, buildEntriesCsv } = require('./export');
const AI = require('./ai');
const PROD = require('./products');
const GOALS = require('./goals');
const FC = require('./forecast');

const PORT = Number(process.env.PORT || 3000);
const UPLOADS = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });

// первый запуск — заполнить демо-данными
const REF = require('./reference');

let BOT = { state: { enabled: false }, notifyReport() {} };
const app = express();
// за прокси (cloudflared локально, Railway в облаке) https и внешний адрес берутся из X-Forwarded-*
app.set('trust proxy', process.env.RAILWAY_ENVIRONMENT || process.env.TRUST_PROXY ? 1 : 'loopback');
app.use(express.json({ limit: '6mb' }));
app.use((req, _res, next) => {
  if (req.secure && BOT.setWebAppUrl) { const host = req.get('host') || ''; if (host && !/^(localhost|127\.)/.test(host)) BOT.setWebAppUrl(`https://${host}`); }
  next();
});
// «/» — лендинг (что такое Wasteless), «/app» — само приложение. Старые ссылки /?tg=1 ведём в приложение.
const PUB = path.join(__dirname, 'public');
app.get('/', (req, res) => (req.query.tg ? res.redirect('/app?tg=1') : res.sendFile(path.join(PUB, 'landing.html'))));
app.get(['/welcome', '/about'], (_req, res) => res.redirect('/'));
app.get('/app', (req, res) => {
  // «/app/» со слэшем ломает относительные пути к стилям — ведём на «/app»
  if (req.originalUrl.split('?')[0].endsWith('/')) return res.redirect(301, '/app' + (req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : ''));
  res.sendFile(path.join(PUB, 'index.html'));
});
app.use(express.static(PUB, { index: false }));

const EDITABLE = ['draft', 'returned'];
const STATUS_RU = { draft: 'черновик', submitted: 'отправлено', in_review: 'на проверке', accepted: 'принято', returned: 'возвращено на доработку' };

// ---------- auth ----------
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
    const i = c.indexOf('='); return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
  }));
}
app.use((req, _res, next) => {
  const sid = parseCookies(req).sid;
  if (sid) {
    req.user = db.prepare(`SELECT u.id, u.full_name, u.email, u.role, u.org_id, o.name org_name, o.short org_short
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN organizations o ON o.id = u.org_id
      WHERE s.token = ? AND u.active = 1`).get(sid);
  }
  next();
});
const auth = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в систему' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
  next();
};
const STAFF = ['reviewer', 'admin', 'manager'];
const bad = (res, msg, code = 400, extra = {}) => res.status(code).json({ error: msg, ...extra });

function startSession(res, userId, req) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?,?,?)').run(token, userId, nowIso());
  const secure = req?.secure ? '; Secure' : ''; // по HTTPS (туннель) cookie только по защищённому каналу
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}${secure}`);
}

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND active = 1').get(String(email || '').trim());
  if (!u || !checkPassword(String(password || ''), u.pass_hash)) return bad(res, 'Неверный e-mail или пароль', 401);
  startSession(res, u.id, req);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  const sid = parseCookies(req).sid;
  if (sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(sid);
  res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
  res.json({ ok: true });
});
app.post('/api/register', (req, res) => {
  const { full_name, email, password, org_id } = req.body || {};
  if (!full_name || !email || !password || !org_id) return bad(res, 'Заполните все поля');
  if (String(password).length < 6) return bad(res, 'Пароль — минимум 6 символов');
  if (!db.prepare('SELECT id FROM organizations WHERE id=? AND active=1').get(+org_id)) return bad(res, 'Организация не найдена');
  if (db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)').get(email)) return bad(res, 'Пользователь с таким e-mail уже есть');
  const r = db.prepare('INSERT INTO users (full_name, email, pass_hash, role, org_id) VALUES (?,?,?,?,?)')
    .run(full_name.trim(), email.trim(), hashPassword(password), 'resp', +org_id);
  startSession(res, Number(r.lastInsertRowid), req);
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ user: req.user || null }));
// язык интерфейса — запоминаем на сервере, чтобы Telegram-бот отвечал на том же языке
app.put('/api/me/lang', auth(), (req, res) => {
  const lang = req.body?.lang === 'kz' ? 'kz' : 'ru';
  db.prepare('UPDATE users SET lang=? WHERE id=?').run(lang, req.user.id);
  res.json({ ok: true, lang });
});

// адрес, по которому система доступна снаружи: PUBLIC_URL из .env → адрес туннеля из запроса → IP в локальной сети
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

// ---------- справочники ----------
app.get('/api/orgs', (req, res) => {
  const rows = db.prepare(`SELECT o.*, (SELECT GROUP_CONCAT(full_name, ', ') FROM users u WHERE u.org_id=o.id AND u.role='resp' AND u.active=1) responsibles
    FROM organizations o ORDER BY o.id`).all();
  res.json(req.user && STAFF.includes(req.user.role) ? rows : rows.filter((o) => o.active).map(({ id, name, short, type }) => ({ id, name, short, type })));
});
app.post('/api/orgs', auth('admin'), (req, res) => {
  const { name, short, type, building } = req.body || {};
  if (!name || !type) return bad(res, 'Укажите название и тип');
  const r = db.prepare('INSERT INTO organizations (name, short, type, building) VALUES (?,?,?,?)').run(name, short || name, type, building || '');
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/orgs/:id', auth('admin'), (req, res) => {
  const o = db.prepare('SELECT * FROM organizations WHERE id=?').get(+req.params.id);
  if (!o) return bad(res, 'Не найдено', 404);
  const n = { ...o, ...req.body };
  db.prepare('UPDATE organizations SET name=?, short=?, type=?, building=?, active=? WHERE id=?').run(n.name, n.short, n.type, n.building, n.active ? 1 : 0, o.id);
  res.json({ ok: true });
});
app.get('/api/orgs/:id/qr', async (req, res) => {
  const url = `${publicUrl(req)}/app#/form?org=${+req.params.id}`;
  res.json({ url, dataUrl: await QRCode.toDataURL(url, { width: 360, margin: 1 }) });
});

app.get('/api/methods', auth(), (_req, res) => res.json(db.prepare('SELECT * FROM disposal_methods ORDER BY rank, id').all()));
const co2In = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
app.post('/api/methods', auth('admin'), (req, res) => {
  const b = req.body || {};
  if (!b.name) return bad(res, 'Укажите название');
  try {
    const r = db.prepare('INSERT INTO disposal_methods (code, name, is_recycling, co2_factor, rank, note) VALUES (?,?,?,?,?,?)')
      .run(b.code ? String(b.code).toUpperCase() : null, b.name.trim(), b.is_recycling ? 1 : 0, co2In(b.co2_factor), +b.rank || 5, b.note || null);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch { bad(res, 'Такой способ или код уже есть'); }
});
app.put('/api/methods/:id', auth('admin'), (req, res) => {
  const m = db.prepare('SELECT * FROM disposal_methods WHERE id=?').get(+req.params.id);
  if (!m) return bad(res, 'Не найдено', 404);
  const n = { ...m, ...req.body };
  db.prepare('UPDATE disposal_methods SET name=?, is_recycling=?, co2_factor=?, rank=?, active=? WHERE id=?')
    .run(n.name, n.is_recycling ? 1 : 0, co2In(n.co2_factor), +n.rank || 5, n.active ? 1 : 0, m.id);
  res.json({ ok: true });
});

// ---------- настройки системы, справочники, отраслевые шаблоны ----------
app.get('/api/config', (_req, res) => res.json(REF.getSettings()));
app.put('/api/config', auth('admin'), (req, res) => { REF.setSettings(req.body || {}); res.json(REF.getSettings()); });
app.post('/api/reference/import', auth('admin'), async (req, res) => {
  const m = /^data:[^;]*;base64,(.+)$/.exec(String(req.body?.file || ''));
  if (!m) return bad(res, 'Приложите файл .xlsx');
  try {
    const parsed = await REF.parseWorkbook(Buffer.from(m[1], 'base64'));
    const stats = REF.applyReference(parsed, { orgId: req.body.org_id ? +req.body.org_id : null });
    res.json({ ...stats, typesInFile: parsed.types.length, methodsInFile: parsed.methods.length });
  } catch (e) { bad(res, 'Не удалось прочитать справочник: ' + e.message); }
});
app.post('/api/reference/industry', auth('admin'), (req, res) => {
  try { res.json(REF.applyIndustry(req.body?.industry, req.body?.org_id ? +req.body.org_id : null)); }
  catch (e) { bad(res, e.message); }
});

// Виды отходов организации (свои + общие)
app.get('/api/waste-types', auth(), (req, res) => {
  let orgId = req.query.org ? +req.query.org : null;
  if (req.user.role === 'resp') orgId = req.user.org_id;
  const all = req.query.all === '1' && STAFF.includes(req.user.role);
  const rows = db.prepare(`SELECT w.*, o.short org_short, m.name default_method, rm.name rec_name, rm.co2_factor rec_co2, rm.rank rec_rank,
      (SELECT COUNT(*) FROM entries e WHERE e.waste_type_id=w.id) used
    FROM waste_types w LEFT JOIN organizations o ON o.id=w.org_id LEFT JOIN disposal_methods m ON m.id=w.default_method_id
    LEFT JOIN disposal_methods rm ON rm.id=w.recommended_method_id
    ${all ? '' : 'WHERE (w.org_id = ? OR w.org_id IS NULL) AND w.active = 1'} ORDER BY w.org_id, w.id`).all(...(all ? [] : [orgId]));
  res.json(rows);
});
app.post('/api/waste-types', auth('resp', 'reviewer', 'admin'), (req, res) => {
  const b = req.body || {};
  const orgId = req.user.role === 'resp' ? req.user.org_id : (b.org_id ? +b.org_id : null);
  const name = String(b.name || '').trim();
  if (!name) return bad(res, 'Укажите наименование отхода');
  if (!['кг', 'л'].includes(b.unit)) return bad(res, 'Единица: кг или л');
  const dup = db.prepare('SELECT id FROM waste_types WHERE lower(name)=lower(?) AND (org_id IS ? OR org_id IS NULL) AND active=1').get(name, orgId);
  if (dup) return bad(res, 'Такой вид отхода уже есть в справочнике');
  const method = b.default_method_id ? +b.default_method_id : db.prepare('SELECT id FROM disposal_methods ORDER BY rank DESC, id LIMIT 1').get().id;
  const category = ['organic', 'recyclable', 'special', 'mixed'].includes(b.category) ? b.category : 'organic';
  // коэффициент ТБО по умолчанию — по категории (DEFRA 2024): органика 0,70021; вторсырьё/смешанные — как картон
  const defCo2 = category === 'organic' || category === 'special' ? 0.70021 : 1.16439;
  const rec = b.recommended_method_id ? +b.recommended_method_id : null;
  const r = db.prepare(`INSERT INTO waste_types (org_id, name, unit, kg_per_unit, category, default_method_id, recommended_method_id, recyclable, co2_factor, max_per_entry, created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(orgId, name, b.unit, b.unit === 'л' ? 0.92 : 1, category, method, rec,
    Math.max(0, Math.min(2, b.recyclable === true ? 2 : +b.recyclable || 0)), b.co2_factor != null && b.co2_factor !== '' ? +b.co2_factor : defCo2, +b.max_per_entry || 200, req.user.id);
  res.json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/waste-types/:id', auth('reviewer', 'admin'), (req, res) => {
  const w = db.prepare('SELECT * FROM waste_types WHERE id=?').get(+req.params.id);
  if (!w) return bad(res, 'Не найдено', 404);
  const n = { ...w, ...req.body };
  db.prepare('UPDATE waste_types SET name=?, unit=?, default_method_id=?, recommended_method_id=?, recyclable=?, co2_factor=?, max_per_entry=?, active=? WHERE id=?')
    .run(n.name, n.unit, +n.default_method_id, n.recommended_method_id ? +n.recommended_method_id : null, Math.max(0, Math.min(2, +n.recyclable || 0)),
      +n.co2_factor, +n.max_per_entry, n.active ? 1 : 0, w.id);
  res.json({ ok: true });
});
app.delete('/api/waste-types/:id', auth('admin'), (req, res) => {
  const used = db.prepare('SELECT COUNT(*) c FROM entries WHERE waste_type_id=?').get(+req.params.id).c;
  if (used) { db.prepare('UPDATE waste_types SET active=0 WHERE id=?').run(+req.params.id); return res.json({ ok: true, deactivated: true }); }
  db.prepare('DELETE FROM waste_types WHERE id=?').run(+req.params.id);
  res.json({ ok: true });
});

// ---------- пользователи (админ) ----------
const ROLES = ['resp', 'reviewer', 'admin', 'manager'];
function checkRoleOrg(role, orgId) {
  if (!ROLES.includes(role)) return 'Неизвестная роль';
  if (role === 'resp' && !db.prepare('SELECT id FROM organizations WHERE id=?').get(+orgId)) return 'Ответственное лицо должно быть привязано к организации';
  return null;
}
app.get('/api/users', auth('admin'), (_req, res) => res.json(db.prepare(`SELECT u.id, u.full_name, u.email, u.role, u.org_id, u.active, o.short org_short
  FROM users u LEFT JOIN organizations o ON o.id=u.org_id ORDER BY u.role, u.id`).all()));
app.post('/api/users', auth('admin'), (req, res) => {
  const { full_name, email, password, role, org_id } = req.body || {};
  if (!full_name || !email || !password || !role) return bad(res, 'Заполните имя пользователя, e-mail, пароль и роль');
  const err = checkRoleOrg(role, org_id); if (err) return bad(res, err);
  try {
    const r = db.prepare('INSERT INTO users (full_name, email, pass_hash, role, org_id) VALUES (?,?,?,?,?)')
      .run(full_name, email, hashPassword(password), role, role === 'resp' ? +org_id : null);
    res.json({ id: Number(r.lastInsertRowid) });
  } catch { bad(res, 'Пользователь с таким e-mail уже есть'); }
});
app.put('/api/users/:id', auth('admin'), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(+req.params.id);
  if (!u) return bad(res, 'Не найдено', 404);
  const n = { ...u, ...req.body };
  const err = checkRoleOrg(n.role, n.org_id); if (err) return bad(res, err);
  db.prepare('UPDATE users SET full_name=?, role=?, org_id=?, active=? WHERE id=?').run(n.full_name, n.role, n.role === 'resp' ? +n.org_id : null, n.active ? 1 : 0, u.id);
  if (req.body.password) db.prepare('UPDATE users SET pass_hash=? WHERE id=?').run(hashPassword(req.body.password), u.id);
  if (!n.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);
  res.json({ ok: true });
});

// ---------- отчёты ----------
function getOrCreateReport(orgId, period) {
  let r = db.prepare('SELECT * FROM reports WHERE org_id=? AND period=?').get(orgId, period);
  if (!r) {
    const id = Number(db.prepare('INSERT INTO reports (org_id, period) VALUES (?,?)').run(orgId, period).lastInsertRowid);
    r = db.prepare('SELECT * FROM reports WHERE id=?').get(id);
  }
  return r;
}
function canSeeReport(user, rep) { return user.role !== 'resp' || rep.org_id === user.org_id; }
function setStatus(rep, to, user, comment) {
  db.prepare(`UPDATE reports SET status=?, last_comment=COALESCE(?, last_comment),
      submitted_at=CASE WHEN ?='submitted' THEN ? ELSE submitted_at END,
      reviewer_id=CASE WHEN ? IN ('in_review','accepted','returned') THEN ? ELSE reviewer_id END,
      decided_at=CASE WHEN ? IN ('accepted','returned') THEN ? ELSE decided_at END WHERE id=?`)
    .run(to, comment || null, to, nowIso(), to, user.id, to, nowIso(), rep.id);
  db.prepare('INSERT INTO status_history (report_id, from_status, to_status, user_id, comment, at) VALUES (?,?,?,?,?,?)')
    .run(rep.id, rep.status, to, user.id, comment || null, nowIso());
}

function reportFull(id) {
  const rep = db.prepare(`SELECT r.*, o.name org_name, o.short org_short, o.type org_type, u.full_name reviewer_name
    FROM reports r JOIN organizations o ON o.id=r.org_id LEFT JOIN users u ON u.id=r.reviewer_id WHERE r.id=?`).get(id);
  if (!rep) return null;
  const entries = A.registryRows({ statuses: Object.keys(STATUS_RU) }).filter((e) => e.report_id === id);
  // итоги за день и за месяц по видам (вычисляются, не хранятся)
  const byType = {}; const byDay = {};
  for (const e of entries) {
    byType[e.type_name] ??= { name: e.type_name, unit: e.unit, qty: 0, kg: 0, recyclable: e.recyclable };
    byType[e.type_name].qty += e.qty; byType[e.type_name].kg += e.kg;
    byDay[e.date] ??= { date: e.date, kg: 0, items: {} };
    byDay[e.date].kg += e.kg;
    byDay[e.date].items[e.type_name] = (byDay[e.date].items[e.type_name] || 0) + e.qty;
  }
  const history = db.prepare(`SELECT h.*, u.full_name user_name, u.role user_role FROM status_history h JOIN users u ON u.id=h.user_id
    WHERE report_id=? ORDER BY h.id`).all(id);
  return {
    ...rep, status_ru: STATUS_RU[rep.status], editable: EDITABLE.includes(rep.status), entries,
    totals: { byType: Object.values(byType).map((t) => ({ ...t, qty: Math.round(t.qty * 100) / 100, kg: Math.round(t.kg * 10) / 10 })).sort((a, b) => b.kg - a.kg),
      byDay: Object.values(byDay).sort((a, b) => b.date.localeCompare(a.date)), kg: Math.round(entries.reduce((a, e) => a + e.kg, 0) * 10) / 10 },
    history: history.map((h) => ({ ...h, from_ru: STATUS_RU[h.from_status] || '—', to_ru: STATUS_RU[h.to_status] })),
  };
}

app.get('/api/reports', auth(), (req, res) => {
  const where = []; const p = [];
  if (req.user.role === 'resp') { where.push('r.org_id=?'); p.push(req.user.org_id); }
  else if (req.query.org) { where.push('r.org_id=?'); p.push(+req.query.org); }
  if (req.query.status) { where.push('r.status=?'); p.push(req.query.status); }
  if (req.query.period) { where.push('r.period=?'); p.push(req.query.period); }
  const rows = db.prepare(`SELECT r.*, o.short org_short, o.name org_name,
      (SELECT COUNT(*) FROM entries e WHERE e.report_id=r.id) n,
      (SELECT ROUND(SUM(e.qty*w.kg_per_unit),1) FROM entries e JOIN waste_types w ON w.id=e.waste_type_id WHERE e.report_id=r.id) kg
    FROM reports r JOIN organizations o ON o.id=r.org_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'in_review' THEN 1 WHEN 'returned' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, r.period DESC, o.id`).all(...p);
  res.json(rows.map((r) => ({ ...r, status_ru: STATUS_RU[r.status] })));
});

// текущий отчёт ответственного лица (черновик за месяц создаётся автоматически)
app.get('/api/my-report', auth('resp'), (req, res) => {
  const cur = A.today().slice(0, 7);
  let period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : cur;
  if (period > cur || period < A.minPeriod()) period = cur; // не создаём черновики за будущие/слишком старые месяцы
  const rep = getOrCreateReport(req.user.org_id, period);
  res.json(reportFull(rep.id));
});

app.get('/api/reports/:id', auth(), (req, res) => {
  let rep = db.prepare('SELECT * FROM reports WHERE id=?').get(+req.params.id);
  if (!rep || !canSeeReport(req.user, rep)) return bad(res, 'Отчёт не найден', 404);
  // проверяющий открыл отправленный отчёт -> «на проверке»
  if (req.user.role === 'reviewer' && rep.status === 'submitted') setStatus(rep, 'in_review', req.user, null);
  const full = reportFull(rep.id);
  if (STAFF.includes(req.user.role)) full.checks = A.reportChecks(rep.id);
  res.json(full);
});

app.post('/api/reports/:id/submit', auth('resp'), (req, res) => {
  const rep = db.prepare('SELECT * FROM reports WHERE id=?').get(+req.params.id);
  if (!rep || rep.org_id !== req.user.org_id) return bad(res, 'Отчёт не найден', 404);
  if (!EDITABLE.includes(rep.status)) return bad(res, `Отчёт в статусе «${STATUS_RU[rep.status]}» — отправить нельзя`);
  if (!db.prepare('SELECT COUNT(*) c FROM entries WHERE report_id=?').get(rep.id).c) return bad(res, 'В отчёте нет записей');
  setStatus(rep, 'submitted', req.user, req.body?.comment || null);
  res.json(reportFull(rep.id));
});
app.post('/api/reports/:id/accept', auth('reviewer', 'admin'), (req, res) => {
  const rep = db.prepare('SELECT * FROM reports WHERE id=?').get(+req.params.id);
  if (!rep) return bad(res, 'Отчёт не найден', 404);
  if (!['submitted', 'in_review'].includes(rep.status)) return bad(res, 'Принять можно только отправленный отчёт');
  setStatus(rep, 'accepted', req.user, req.body?.comment || null);
  BOT.notifyReport(rep.id, 'accepted');
  res.json(reportFull(rep.id));
});
app.post('/api/reports/:id/return', auth('reviewer', 'admin'), (req, res) => {
  const rep = db.prepare('SELECT * FROM reports WHERE id=?').get(+req.params.id);
  if (!rep) return bad(res, 'Отчёт не найден', 404);
  const comment = String(req.body?.comment || '').trim();
  if (!comment) return bad(res, 'При возврате комментарий обязателен');
  if (!['submitted', 'in_review'].includes(rep.status)) return bad(res, 'Вернуть можно только отправленный отчёт');
  setStatus(rep, 'returned', req.user, comment);
  BOT.notifyReport(rep.id, 'returned', comment);
  res.json(reportFull(rep.id));
});

// ---------- записи (взвешивания) ----------
function savePhoto(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const name = `${crypto.randomBytes(10).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[2], 'base64'));
  return name;
}
function validateEntry(user, b, existingId) {
  const date = String(b.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Укажите дату';
  if (date > A.today()) return 'Дата не может быть в будущем';
  if (date.slice(0, 7) < A.minPeriod()) return 'Можно вносить записи не старше 12 месяцев';
  const qty = Number(String(b.qty).replace(',', '.'));
  if (!(qty > 0)) return 'Вес/объём должен быть больше 0';
  const w = db.prepare('SELECT * FROM waste_types WHERE id=? AND active=1 AND (org_id=? OR org_id IS NULL)').get(+b.waste_type_id, user.org_id);
  if (!w) return 'Выберите вид отхода из списка';
  if (qty > w.max_per_entry) return `Значение ${qty} ${w.unit} выше разумного предела (${w.max_per_entry} ${w.unit}) для «${w.name}». Проверьте ввод`;
  if (!db.prepare('SELECT id FROM disposal_methods WHERE id=? AND active=1').get(+b.method_id)) return 'Выберите способ утилизации';
  return { date, qty, w };
}
// фото, загруженное для распознавания, можно один раз привязать к записи (не загружая повторно)
const photoRefs = new Map(); // name -> { userId, at }
function takePhotoRef(user, name) {
  const r = name && photoRefs.get(String(name));
  if (!r || r.userId !== user.id || Date.now() - r.at > 3600e3) return null;
  return String(name);
}
app.post('/api/entries', auth('resp'), (req, res) => {
  // офлайн-очередь: client_id — защита от повторной отправки той же записи
  const clientId = req.body?.client_id ? String(req.body.client_id).slice(0, 64) : null;
  if (clientId) {
    const ex = db.prepare('SELECT e.id, e.report_id FROM entries e WHERE e.client_id=? AND e.user_id=?').get(clientId, req.user.id);
    if (ex) return res.json({ id: ex.id, duplicate: true, report: reportFull(ex.report_id) });
  }
  const v = validateEntry(req.user, req.body || {});
  if (typeof v === 'string') return bad(res, v);
  const rep = getOrCreateReport(req.user.org_id, v.date.slice(0, 7));
  if (!EDITABLE.includes(rep.status)) return bad(res, `Отчёт за ${A.monthFull(rep.period)} в статусе «${STATUS_RU[rep.status]}» — добавление записей заблокировано`);
  if (!req.body.force) {
    const dup = db.prepare('SELECT id FROM entries WHERE report_id=? AND date=? AND waste_type_id=? AND qty=?').get(rep.id, v.date, v.w.id, v.qty);
    if (dup) return bad(res, `Похоже на дубль: «${v.w.name}» ${v.qty} ${v.w.unit} за эту дату уже внесено. Сохранить всё равно?`, 409, { duplicate: true });
  }
  const photo = takePhotoRef(req.user, req.body.photo_ref) || savePhoto(req.body.photo);
  const source = ['manual', 'voice', 'photo', 'offline'].includes(req.body.source) ? req.body.source : 'manual';
  const prod = req.body.product_id ? db.prepare('SELECT id FROM products WHERE id=?').get(+req.body.product_id) : null;
  const r = db.prepare('INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, photo, note, created_at, source, product_id, client_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(rep.id, v.date, v.w.id, v.qty, +req.body.method_id, req.user.id, photo, req.body.note || null, nowIso(), source, prod ? prod.id : null, clientId);
  res.json({ id: Number(r.lastInsertRowid), report: reportFull(rep.id) });
});
function ownEditableEntry(req, res) {
  const e = db.prepare('SELECT e.*, r.org_id, r.status FROM entries e JOIN reports r ON r.id=e.report_id WHERE e.id=?').get(+req.params.id);
  if (!e || e.org_id !== req.user.org_id) { bad(res, 'Запись не найдена', 404); return null; }
  if (!EDITABLE.includes(e.status)) { bad(res, 'Отчёт уже отправлен или принят — запись заблокирована'); return null; }
  return e;
}
app.put('/api/entries/:id', auth('resp'), (req, res) => {
  const e = ownEditableEntry(req, res); if (!e) return;
  const v = validateEntry(req.user, { ...e, ...req.body });
  if (typeof v === 'string') return bad(res, v);
  if (v.date.slice(0, 7) !== e.date.slice(0, 7)) return bad(res, 'Перенос записи в другой месяц невозможен — удалите и внесите заново');
  const pid = req.body.product_id === undefined ? e.product_id : (req.body.product_id ? +req.body.product_id : null);
  db.prepare('UPDATE entries SET date=?, waste_type_id=?, qty=?, method_id=?, product_id=? WHERE id=?').run(v.date, v.w.id, v.qty, +(req.body.method_id ?? e.method_id), pid, e.id);
  res.json({ ok: true, report: reportFull(e.report_id) });
});
app.delete('/api/entries/:id', auth('resp'), (req, res) => {
  const e = ownEditableEntry(req, res); if (!e) return;
  db.prepare('DELETE FROM entries WHERE id=?').run(e.id);
  res.json({ ok: true, report: reportFull(e.report_id) });
});
app.get('/api/photo/:name', auth(), (req, res) => {
  const name = path.basename(req.params.name);
  const e = db.prepare('SELECT r.org_id FROM entries e JOIN reports r ON r.id=e.report_id WHERE e.photo=?').get(name);
  if (!e || (req.user.role === 'resp' && e.org_id !== req.user.org_id)) return res.status(404).end();
  res.sendFile(path.join(UPLOADS, name));
});

// ---------- реестр, сводка, аналитика ----------
app.get('/api/registry', auth(...STAFF), (req, res) => {
  const q = req.query;
  const rows = A.registryRows({ from: q.from, to: q.to, orgId: q.org, typeName: q.type, methodId: q.method });
  const kg = rows.reduce((a, r) => a + r.kg, 0);
  res.json({ total: rows.length, kg: Math.round(kg * 10) / 10, co2: Math.round(rows.reduce((a, r) => a + r.co2, 0) * 10) / 10,
    rows: rows.slice(0, 1000).map(({ id, date, org_short, type_name, qty, unit, method_name, user_name, period, photo }) => ({ id, date, org_short, type_name, qty, unit, method_name, user_name, period, photo })) });
});

// выгрузка реестра по текущим фильтрам: Excel (по структуре журнала) и CSV (для BI)
const regRows = (q) => A.registryRows({ from: q.from, to: q.to, orgId: q.org, typeName: q.type, methodId: q.method });
const fname = (s) => encodeURIComponent(s);
app.get('/api/registry.xlsx', auth(...STAFF), async (req, res) => {
  const rows = regRows(req.query);
  const sub = `Единый реестр (принятые отчёты) · ${req.query.from || 'начало'} — ${req.query.to || A.today()} · записей ${rows.length}`;
  const buf = await buildEntriesXlsx(rows, { title: 'Реестр пищевых отходов — выгрузка по фильтру', sub });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname(`Реестр_${req.query.from || ''}_${req.query.to || A.today()}.xlsx`)}`);
  res.send(Buffer.from(buf));
});
app.get('/api/registry.csv', auth(...STAFF), (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname(`registry_${req.query.from || ''}_${req.query.to || A.today()}.csv`)}`);
  res.send(buildEntriesCsv(regRows(req.query)));
});
// «Моя сводка» ответственного лица: сегодня, неделя к прошлой, месяц, график 7 дней
app.get('/api/my-summary', auth('resp'), (req, res) => {
  const t = A.today();
  const strip = ({ rows, ...x }) => x;
  const week = A.periodStats({ orgId: req.user.org_id, ...A.namedPeriod('week') });
  const month = A.periodStats({ orgId: req.user.org_id, ...A.namedPeriod('month') });
  const today = A.periodStats({ orgId: req.user.org_id, from: t, to: t });
  const rep = getOrCreateReport(req.user.org_id, t.slice(0, 7));
  const rt = GOALS.rating();
  const mine = rt.rows.find((r) => r.org_id === req.user.org_id);
  res.json({ today: strip(today), week: strip(week), month: strip(month), report: { id: rep.id, status: rep.status, status_ru: STATUS_RU[rep.status], period: rep.period, last_comment: rep.last_comment },
    goal: mine ? { ...mine, of: rt.rows.length } : null });
});

// ---------- цели и рейтинг подразделений ----------
app.get('/api/rating', auth(), (req, res) => {
  const p = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : undefined;
  res.json({ ...GOALS.rating(p), myOrg: req.user.org_id || null });
});
app.put('/api/goals/:orgId', auth('reviewer', 'admin'), (req, res) => {
  if (!db.prepare('SELECT id FROM organizations WHERE id=?').get(+req.params.orgId)) return bad(res, 'Организация не найдена', 404);
  res.json(GOALS.setGoal(+req.params.orgId, req.body || {}, req.user.id));
});
app.get('/api/my-report.xlsx', auth('resp'), async (req, res) => {
  const p = A.namedPeriod(['week', 'month', 'quarter', 'prev_month'].includes(req.query.p) ? req.query.p : 'month');
  const st = A.periodStats({ orgId: req.user.org_id, ...p });
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
app.get('/api/summary', auth(...STAFF), (req, res) => {
  const { kind, value } = periodParams(req.query);
  const s = A.summary(kind, value); delete s.rows;
  res.json(s);
});
app.get('/api/summary.xlsx', auth(...STAFF), async (req, res) => {
  const { kind, value } = periodParams(req.query);
  const s = A.summary(kind, value);
  s.conclusion = await AI.conclusion(AI.factsFrom(s.label, { ...s, rows: undefined }));
  const buf = await buildSummaryXlsx(s);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ATU_waste_report_${value}.xlsx"`);
  res.send(Buffer.from(buf));
});

app.get('/api/dashboard', auth(), (req, res) => {
  const t = A.today();
  let to = req.query.to || t;
  let from = req.query.from;
  if (!from) { const d = new Date(t.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 5); from = d.toISOString().slice(0, 10); }
  const orgId = req.user.role === 'resp' ? req.user.org_id : (req.query.org || null);
  res.json(A.dashboard({ from, to, orgId }));
});

app.get('/api/missing', auth(...STAFF), (req, res) => {
  const period = /^\d{4}-\d{2}$/.test(req.query.period || '') ? req.query.period : A.today().slice(0, 7);
  res.json({ period, label: A.monthFull(period), orgs: A.missingReports(period).map((o) => ({ ...o, status_ru: STATUS_RU[o.status] || o.status })) });
});

// ---------- Telegram ----------
app.get('/api/telegram/status', auth(), (req, res) => {
  const u = db.prepare('SELECT tg_chat_id FROM users WHERE id=?').get(req.user.id);
  res.json({ enabled: BOT.state.enabled, username: BOT.state.username, error: BOT.state.error || null, linked: !!u.tg_chat_id });
});
app.post('/api/telegram/link', auth(), (req, res) => {
  if (!BOT.state.username) return bad(res, BOT.state.enabled ? 'Бот ещё запускается или нет связи с Telegram' : 'Бот не подключён: добавьте TELEGRAM_BOT_TOKEN в .env и перезапустите сервер');
  const code = crypto.randomBytes(9).toString('base64url');
  db.prepare('DELETE FROM tg_links WHERE user_id=?').run(req.user.id);
  db.prepare('INSERT INTO tg_links (code, user_id, expires_at) VALUES (?,?,?)').run(code, req.user.id, new Date(Date.now() + 15 * 60e3).toISOString());
  res.json({ url: `https://t.me/${BOT.state.username}?start=${code}`, username: BOT.state.username });
});
// Вход из мини-приложения Telegram: проверяем подпись initData (HMAC-SHA256 с токеном бота)
// и открываем сессию пользователю, чей Telegram привязан к аккаунту. Пароль не нужен.
app.post('/api/telegram/webapp-login', (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const initData = String(req.body?.initData || '');
  if (!token || !initData) return bad(res, 'Нет данных Telegram', 400);
  const params = new URLSearchParams(initData);
  const hash = params.get('hash'); params.delete('hash');
  const check = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  if (!hash || hash.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(calc))) return bad(res, 'Подпись Telegram не прошла проверку', 401);
  if (Date.now() / 1000 - Number(params.get('auth_date') || 0) > 24 * 3600) return bad(res, 'Сессия Telegram устарела — откройте приложение заново', 401);
  let tgUser; try { tgUser = JSON.parse(params.get('user') || '{}'); } catch { tgUser = {}; }
  const u = tgUser.id && db.prepare('SELECT id FROM users WHERE tg_chat_id=? AND active=1').get(String(tgUser.id));
  if (!u) return bad(res, 'Этот Telegram не привязан к аккаунту. Войдите и нажмите «Подключить Telegram».', 403, { needLink: true });
  startSession(res, u.id, req);
  res.json({ ok: true });
});
app.post('/api/telegram/unlink', auth(), (req, res) => { db.prepare('UPDATE users SET tg_chat_id=NULL WHERE id=?').run(req.user.id); res.json({ ok: true }); });

// ---------- ИИ ----------
app.get('/api/ai/status', auth(), (_req, res) => res.json({ enabled: AI.enabled(), model: AI.MODEL }));
app.post('/api/ai/parse', auth('resp'), async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return bad(res, 'Скажите или напишите, что взвесили');
  const types = orgTypes(req.user.org_id);
  const r = await AI.parse(text, types);
  res.json({ ...r, items: withNames(r.items, types) });
});
const orgTypes = (orgId) => db.prepare('SELECT id, name, unit, category, default_method_id FROM waste_types WHERE (org_id=? OR org_id IS NULL) AND active=1').all(orgId);
const withNames = (items, types) => items.map((x) => { const t = types.find((y) => y.id === x.waste_type_id); return { ...x, name: t.name, unit: t.unit, method_id: t.default_method_id }; });
// распознавание по фото: продукт/вид и вес (табло весов или оценка); фото сохраняется и привязывается к записям
app.post('/api/ai/photo', auth('resp'), async (req, res) => {
  const name = savePhoto(req.body?.photo);
  if (!name) return bad(res, 'Приложите фото (JPEG/PNG)');
  photoRefs.set(name, { userId: req.user.id, at: Date.now() });
  const types = orgTypes(req.user.org_id);
  try {
    const r = await AI.photo(req.body.photo, types);
    res.json({ ...r, items: withNames(r.items, types), photo_ref: name });
  } catch (e) { bad(res, e.message); }
});

// ---------- справочник продуктов (датасет) ----------
app.get('/api/products', auth(), (req, res) => {
  const all = req.query.all === '1' && req.user.role === 'admin';
  const rows = PROD.list(all);
  const used = Object.fromEntries(db.prepare('SELECT product_id, COUNT(*) n FROM entries WHERE product_id IS NOT NULL GROUP BY product_id').all().map((r) => [r.product_id, r.n]));
  // для ответственного лица — сразу вид отхода его организации, куда попадёт продукт
  const types = req.user.org_id ? orgTypes(req.user.org_id) : null;
  res.json({ kinds: Object.fromEntries(Object.entries(PROD.KINDS).map(([k, v]) => [k, v.label])),
    products: rows.map((p) => ({ ...p, used: used[p.id] || 0, ...(types ? { type_id: PROD.typeFor(p, types)?.id || null } : {}) })) });
});
app.post('/api/products', auth('admin'), (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return bad(res, 'Укажите название продукта');
  res.json(PROD.importRows([b]));
});
app.put('/api/products/:id', auth('admin'), (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(+req.params.id);
  if (!p) return bad(res, 'Продукт не найден', 404);
  const b = { ...p, ...req.body };
  db.prepare('UPDATE products SET name_kz=?, synonyms=?, kind=?, price_kzt_kg=?, active=?, updated_at=? WHERE id=?')
    .run(b.name_kz || null, String(b.synonyms || ''), PROD.KINDS[b.kind] ? b.kind : p.kind, Number(b.price_kzt_kg) || 0, b.active ? 1 : 0, nowIso(), p.id);
  res.json({ ok: true });
});
// импорт датасета: CSV (name;name_kz;synonyms;kind;price_kzt_kg) или xlsx с теми же столбцами
app.post('/api/products/import', auth('admin'), async (req, res) => {
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
    res.json(PROD.importRows(rows));
  } catch (e) { bad(res, 'Не удалось прочитать файл: ' + e.message); }
});
app.get('/api/products.csv', auth('admin'), (_req, res) => {
  const rows = PROD.list(true);
  const csv = '\uFEFFname;name_kz;synonyms;kind;price_kzt_kg\n' + rows.map((p) => [p.name, p.name_kz || '', p.synonyms, p.kind, p.price_kzt_kg].join(';')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="products.csv"'); res.send(csv);
});
app.get('/api/ai/conclusion', auth(), async (req, res) => {
  let facts;
  if (req.query.kind) {
    if (req.user.role === 'resp') return bad(res, 'Недостаточно прав', 403);
    const { kind, value } = periodParams(req.query);
    const s = A.summary(kind, value); delete s.rows;
    facts = AI.factsFrom(s.label, s);
  } else {
    const t = A.today(); const from = req.query.from || `${t.slice(0, 7)}-01`; const to = req.query.to || t;
    const orgId = req.user.role === 'resp' ? req.user.org_id : (req.query.org || null);
    const d = A.dashboard({ from, to, orgId });
    facts = AI.factsFrom(`${from} — ${to}${orgId ? ', ' + (d.orgs[0] || '') : ', все организации'}`, d);
  }
  res.json(await AI.conclusion(facts));
});

// ---------- Электронные весы (стык с треком 2) ----------
// Устройство шлёт: POST /api/scale/entries, заголовок X-Device-Token, тело {waste_type_id | waste_type, weight_kg, date?}
function scaleInsert(orgId, b) {
  const t = b.waste_type_id
    ? db.prepare('SELECT * FROM waste_types WHERE id=? AND (org_id=? OR org_id IS NULL) AND active=1').get(+b.waste_type_id, orgId)
    : db.prepare('SELECT * FROM waste_types WHERE lower(name)=lower(?) AND (org_id=? OR org_id IS NULL) AND active=1').get(String(b.waste_type || ''), orgId);
  if (!t) return { error: 'Вид отхода не найден в справочнике организации' };
  const kg = Number(b.weight_kg);
  if (!(kg > 0) || kg > t.max_per_entry * t.kg_per_unit) return { error: 'Недопустимый вес' };
  const date = A.today();
  const rep = getOrCreateReport(orgId, date.slice(0, 7));
  if (!EDITABLE.includes(rep.status)) return { error: `Отчёт за период в статусе «${STATUS_RU[rep.status]}» — запись заблокирована` };
  const resp = db.prepare("SELECT id FROM users WHERE org_id=? AND role='resp' AND active=1 ORDER BY id LIMIT 1").get(orgId);
  if (!resp) return { error: 'У организации нет ответственного лица' };
  const qty = Math.round((kg / t.kg_per_unit) * 100) / 100;
  const id = Number(db.prepare("INSERT INTO entries (report_id, date, waste_type_id, qty, method_id, user_id, created_at, source, note) VALUES (?,?,?,?,?,?,?,'scale',?)")
    .run(rep.id, date, t.id, qty, t.default_method_id, resp.id, nowIso(), b.device || 'весы').lastInsertRowid);
  return { id, report_id: rep.id, waste_type: t.name, qty, unit: t.unit };
}
app.post('/api/scale/entries', (req, res) => {
  const token = String(req.headers['x-device-token'] || '');
  const dev = token && db.prepare('SELECT * FROM scale_devices WHERE token_hash=? AND active=1').get(crypto.createHash('sha256').update(token).digest('hex'));
  if (!dev) return bad(res, 'Неизвестное устройство', 401);
  const r = scaleInsert(dev.org_id, { ...req.body, device: dev.name });
  if (r.error) return bad(res, r.error);
  res.json(r);
});
// эмулятор весов для демо: ответственное лицо «кладёт отход на весы» выбранного вида
app.post('/api/scale/emulate', auth('resp'), (req, res) => {
  const t = db.prepare('SELECT * FROM waste_types WHERE id=?').get(+req.body?.waste_type_id);
  if (!t) return bad(res, 'Выберите вид отхода');
  const kg = Math.round((Math.max(0.3, t.max_per_entry * 0.04) * (0.6 + Math.random() * 0.8)) * 10) / 10;
  const r = scaleInsert(req.user.org_id, { waste_type_id: t.id, weight_kg: kg, device: 'Весы (эмулятор)' });
  if (r.error) return bad(res, r.error);
  res.json({ ...r, report: reportFull(r.report_id) });
});
app.get('/api/scale/devices', auth('admin'), (_req, res) => res.json(db.prepare(`SELECT d.id, d.name, d.token_hint, d.active, o.short org_short FROM scale_devices d JOIN organizations o ON o.id=d.org_id ORDER BY d.id`).all()));
app.post('/api/scale/devices', auth('admin'), (req, res) => {
  const org = db.prepare('SELECT id, short FROM organizations WHERE id=?').get(+req.body?.org_id);
  if (!org) return bad(res, 'Укажите организацию');
  const token = 'dev_' + crypto.randomBytes(18).toString('hex');
  db.prepare('INSERT INTO scale_devices (org_id, name, token_hash, token_hint) VALUES (?,?,?,?)')
    .run(org.id, req.body.name || `Весы · ${org.short}`, crypto.createHash('sha256').update(token).digest('hex'), token.slice(0, 8) + '…');
  res.json({ token }); // показывается один раз
});

// ---------- производство и прогноз «сколько готовить» ----------
const orgParam = (req) => (req.user.role === 'resp' ? req.user.org_id : +req.query.org || +req.body?.org_id || null);
const isoDate = (v, def) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : def);
app.get('/api/forecast', auth(), (req, res) => {
  const orgId = orgParam(req);
  if (!orgId) return bad(res, 'Выберите организацию');
  let date = isoDate(req.query.date, FC.addDays(A.today(), 1));
  let f = FC.forecast(orgId, date);
  // без явной даты: если завтра выходной — показываем ближайший рабочий день
  for (let k = 0; !req.query.date && f.closed && k < 6; k++) { date = FC.addDays(date, 1); f = FC.forecast(orgId, date); }
  res.json({ ...f, track: FC.track(orgId, A.today()) });
});
// итог дня по блюдам: приготовлено / осталось; плюс блюда, которые организация обычно готовит
app.get('/api/production', auth(), (req, res) => {
  const orgId = orgParam(req);
  if (!orgId) return bad(res, 'Выберите организацию');
  const date = isoDate(req.query.date, A.today());
  const usual = db.prepare(`SELECT pr.id product_id, pr.name, pr.name_kz, COUNT(*) n FROM production p JOIN products pr ON pr.id=p.product_id
    WHERE p.org_id=? AND p.date >= ? GROUP BY pr.id ORDER BY n DESC, pr.name`).all(orgId, FC.addDays(date, -42));
  res.json({ date, rows: FC.dayRows(orgId, date), usual });
});
app.post('/api/production', auth('resp'), (req, res) => {
  const date = isoDate(req.body?.date, null);
  if (!date) return bad(res, 'Укажите дату');
  if (date > A.today()) return bad(res, 'Дата не может быть в будущем');
  if (date < FC.addDays(A.today(), -14)) return bad(res, 'Итог дня можно внести не позже чем через 14 дней');
  try { res.json({ saved: FC.saveDay(req.user.org_id, req.user.id, date, Array.isArray(req.body.items) ? req.body.items : []) }); }
  catch (e) { bad(res, e.message); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

(async () => {
  // первый запуск — справочник организаторов + демо-данные
  if (!db.prepare('SELECT COUNT(*) c FROM organizations').get().c) await require('./seed').seed();
  // демо-история производства для прогноза (только если таблица пустая; отключить: NO_DEMO_PRODUCTION=1)
  if (!process.env.NO_DEMO_PRODUCTION) { const n = FC.seedDemo(A.today()); if (n) console.log(`Демо-история производства: ${n} строк`); }
  BOT = require('./telegram').start({ db, A, AI, PROD, savePhoto, getOrCreateReport, reportFull, setStatus, validateEntry, EDITABLE, STATUS_RU, nowIso,
    buildEntriesXlsx, buildSummaryXlsx, publicUrl: () => process.env.PUBLIC_URL || lanUrl() });
  app.listen(PORT, '0.0.0.0', () => {
  console.log(`АТУ · учёт пищевых отходов: http://localhost:${PORT}`);
  console.log(`Со смартфона в той же сети: ${lanUrl()}`);
});
})();
