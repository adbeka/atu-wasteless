// Аккаунты: регистрация компании (владелец = администратор), личного пользователя (домашний учёт),
// присоединение сотрудника по приглашению. Используется сайтом и Telegram-ботом.
const crypto = require('crypto');
const { db, hashPassword, nowIso } = require('./db');
const REF = require('./reference');

const ROLES = ['resp', 'reviewer', 'admin', 'manager'];
const ROLE_RU = { resp: 'Ответственное лицо', reviewer: 'Проверяющий', admin: 'Администратор', manager: 'Руководство', personal: 'Личный аккаунт' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

class AccountError extends Error {}
const fail = (msg) => { throw new AccountError(msg); };

function checkPasswordRules(pw) {
  pw = String(pw || '');
  if (pw.length < 8) fail('Пароль — минимум 8 символов');
  if (!/[A-Za-zА-Яа-яЁё]/.test(pw) || !/\d/.test(pw)) fail('Пароль должен содержать буквы и цифры');
  if (pw.length > 200) fail('Слишком длинный пароль');
}
async function checkNewUser({ full_name, email, password }, { skipPassword = false } = {}) {
  const name = String(full_name || '').trim();
  const mail = String(email || '').trim().toLowerCase();
  if (name.length < 2) fail('Укажите имя');
  if (!EMAIL_RE.test(mail)) fail('Укажите корректный e-mail');
  if (!skipPassword) checkPasswordRules(password);
  if (await db.prepare('SELECT id FROM users WHERE lower(email)=?').get(mail)) fail('Пользователь с таким e-mail уже зарегистрирован — войдите');
  return { name: name.slice(0, 80), mail };
}
const insertUser = async (tenantId, name, mail, passHash, role, orgId, extra = {}) => Number((await db.prepare(
  'INSERT INTO users (tenant_id, full_name, email, pass_hash, role, org_id, created_at, tg_chat_id, lang) VALUES (?,?,?,?,?,?,?,?,?)',
).run(tenantId, name, mail, passHash, role, orgId, nowIso(), extra.tg_chat_id || null, extra.lang || 'ru')).lastInsertRowid);

// Компания: tenant + первое подразделение с видами отходов по отраслевому шаблону + владелец-администратор
async function createCompany(b) {
  const company = String(b.company || '').trim();
  if (company.length < 2) fail('Укажите название компании');
  const industry = REF.INDUSTRIES[b.industry] && !REF.INDUSTRIES[b.industry].personal ? b.industry : 'horeca';
  const { name, mail } = await checkNewUser(b);
  return db.tx(async () => {
    const tid = Number((await db.prepare("INSERT INTO tenants (name, kind, industry, created_at) VALUES (?, 'company', ?, ?)").run(company.slice(0, 120), industry, nowIso())).lastInsertRowid);
    await REF.setSettings(tid, { company, industry, resetLabels: true });
    const orgName = String(b.org_name || '').trim() || 'Основное подразделение';
    const orgType = String(b.org_type || '').trim() || (industry === 'university' ? 'столовая' : 'подразделение');
    const orgId = Number((await db.prepare('INSERT INTO organizations (tenant_id, name, short, type) VALUES (?,?,?,?)').run(tid, orgName.slice(0, 120), orgName.slice(0, 40), orgType.slice(0, 40))).lastInsertRowid);
    await REF.applyIndustry(tid, industry, orgId);
    const userId = await insertUser(tid, name, mail, hashPassword(b.password), 'admin', null);
    return { tenantId: tid, userId, orgId };
  });
}

// Личный аккаунт: свой tenant «Моя кухня» с домашними видами отходов
async function createPersonal(b, { viaTelegram = null } = {}) {
  let name, mail, pass;
  if (viaTelegram) {
    name = String(b.full_name || 'Пользователь Telegram').trim().slice(0, 80) || 'Пользователь Telegram';
    mail = `tg${viaTelegram}@telegram.wasteless`; // служебный адрес; e-mail и пароль можно задать позже в профиле
    if (await db.prepare('SELECT id FROM users WHERE email=?').get(mail)) fail('Этот Telegram уже привязан к аккаунту');
    pass = hashPassword(crypto.randomBytes(24).toString('hex'));
  } else {
    ({ name, mail } = await checkNewUser(b));
    pass = hashPassword(b.password);
  }
  return db.tx(async () => {
    const tid = Number((await db.prepare("INSERT INTO tenants (name, kind, industry, created_at) VALUES (?, 'personal', 'home', ?)").run(`Личный: ${name}`, nowIso())).lastInsertRowid);
    const orgId = Number((await db.prepare("INSERT INTO organizations (tenant_id, name, short, type) VALUES (?, 'Моя кухня', 'Моя кухня', 'дом')").run(tid)).lastInsertRowid);
    await REF.applyIndustry(tid, 'home', orgId);
    const userId = await insertUser(tid, name, mail, pass, 'personal', orgId, { tg_chat_id: viaTelegram ? String(viaTelegram) : null, lang: b.lang === 'kz' ? 'kz' : 'ru' });
    return { tenantId: tid, userId, orgId };
  });
}

// ---------- приглашения ----------
async function createInvite(user, { role, org_id, max_uses, days }) {
  if (!ROLES.includes(role)) fail('Выберите роль');
  let orgId = null;
  if (role === 'resp') {
    const o = await db.prepare('SELECT id FROM organizations WHERE id=? AND tenant_id=? AND active=1').get(+org_id, user.tenant_id);
    if (!o) fail('Ответственному лицу нужно подразделение');
    orgId = o.id;
  }
  const code = crypto.randomBytes(12).toString('base64url');
  const exp = new Date(Date.now() + Math.min(30, Math.max(1, +days || 7)) * 864e5).toISOString();
  await db.prepare('INSERT INTO invites (code, tenant_id, role, org_id, created_by, expires_at, max_uses, created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(code, user.tenant_id, role, orgId, user.id, exp, Math.min(100, Math.max(1, +max_uses || 1)), nowIso());
  return { code, expires_at: exp };
}
async function inviteInfo(code) {
  const inv = await db.prepare(`SELECT i.*, t.name company, o.short org_short FROM invites i JOIN tenants t ON t.id=i.tenant_id
    LEFT JOIN organizations o ON o.id=i.org_id WHERE i.code=?`).get(String(code || ''));
  if (!inv || inv.expires_at < nowIso() || inv.uses >= inv.max_uses) return null;
  return inv;
}
async function joinByInvite(b) {
  const inv = await inviteInfo(b.code);
  if (!inv) fail('Приглашение недействительно или уже использовано — попросите администратора выслать новое');
  const { name, mail } = await checkNewUser(b);
  return db.tx(async () => {
    const r = await db.prepare('UPDATE invites SET uses=uses+1 WHERE id=? AND uses < max_uses').run(inv.id);
    if (!r.changes) fail('Приглашение уже использовано');
    const userId = await insertUser(inv.tenant_id, name, mail, hashPassword(b.password), inv.role, inv.org_id);
    return { tenantId: inv.tenant_id, userId };
  });
}

module.exports = { AccountError, ROLES, ROLE_RU, checkPasswordRules, createCompany, createPersonal, createInvite, inviteInfo, joinByInvite };
