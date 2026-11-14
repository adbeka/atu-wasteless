// База данных: PostgreSQL в облаке (DATABASE_URL) или SQLite локально (node:sqlite) — один асинхронный интерфейс.
//   await db.prepare(sql).get(...p) / .all(...p) / .run(...p) → { changes, lastInsertRowid }
//   await db.tx(async () => { ... })   — транзакция (все запросы внутри идут в одном соединении)
// SQL пишется один раз: плейсхолдеры «?», IS NOT DISTINCT FROM, string_agg, ROUND(CAST(x AS NUMERIC), n),
// INSERT … ON CONFLICT — понимают обе базы. Для Postgres адаптер переводит «?» в $1…$n и добавляет RETURNING id.
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const PG_URL = process.env.DATABASE_URL || '';
const IS_PG = /^postgres(ql)?:\/\//.test(PG_URL);
const als = new AsyncLocalStorage();
// таблицы с автоинкрементным id — для них INSERT в Postgres возвращает id
const ID_TABLES = new Set(['tenants', 'organizations', 'users', 'disposal_methods', 'waste_types', 'reports', 'entries', 'status_history',
  'scale_devices', 'products', 'production', 'invites']);

function toPg(sql) {
  let i = 0, out = '', q = false;
  for (const ch of sql) {
    if (ch === "'") q = !q;
    out += !q && ch === '?' ? `$${++i}` : ch;
  }
  return out;
}

let impl;
if (IS_PG) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => parseInt(v, 10));   // COUNT(*) и bigint — числом
  types.setTypeParser(1700, (v) => parseFloat(v));   // NUMERIC (ROUND) — числом
  const pool = new Pool({ connectionString: PG_URL, max: 10, ssl: /sslmode=require|railway\.app|\.rlwy\.net/.test(PG_URL) && !/sslmode=disable/.test(PG_URL) ? { rejectUnauthorized: false } : undefined });
  const client = () => als.getStore() || pool;
  impl = {
    kind: 'postgres',
    async query(sql, params) { return client().query(toPg(sql), params.map((v) => (v === undefined ? null : v))); },
    async run(sql, params) {
      let s = sql.trim();
      const m = /^INSERT\s+INTO\s+(\w+)/i.exec(s);
      if (m && ID_TABLES.has(m[1].toLowerCase()) && !/RETURNING/i.test(s)) s += ' RETURNING id';
      const r = await impl.query(s, params);
      return { changes: r.rowCount, lastInsertRowid: r.rows?.[0]?.id ?? null };
    },
    async get(sql, params) { return (await impl.query(sql, params)).rows[0]; },
    async all(sql, params) { return (await impl.query(sql, params)).rows; },
    async exec(sql) { await client().query(sql); },
    async tx(fn) {
      if (als.getStore()) return fn();
      const c = await pool.connect();
      try { await c.query('BEGIN'); const r = await als.run(c, fn); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
      finally { c.release(); }
    },
    ddl: (sql) => sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY').replace(/\bREAL\b/g, 'DOUBLE PRECISION'),
    async addColumn(table, def) { await impl.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${impl.ddl(def)}`); },
    end: () => pool.end(),
  };
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'waste.db');
  require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const s = new DatabaseSync(DB_PATH);
  s.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const norm = (row) => (row ? { ...row } : row); // без null-прототипа — как обычные объекты из pg
  let depth = 0;
  impl = {
    kind: 'sqlite', raw: s,
    async run(sql, params) { const r = s.prepare(sql).run(...params); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    async get(sql, params) { return norm(s.prepare(sql).get(...params)); },
    async all(sql, params) { return s.prepare(sql).all(...params).map(norm); },
    async exec(sql) { s.exec(sql); },
    async tx(fn) {
      if (als.getStore()) return fn();
      s.exec('BEGIN'); depth++;
      try { const r = await als.run(true, fn); s.exec('COMMIT'); return r; }
      catch (e) { s.exec('ROLLBACK'); throw e; }
      finally { depth--; }
    },
    ddl: (sql) => sql,
    async addColumn(table, def) { try { s.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`); } catch { /* колонка уже есть */ } },
    end: async () => s.close(),
  };
}

const db = {
  kind: impl.kind,
  prepare: (sql) => ({
    get: (...p) => impl.get(sql, p),
    all: (...p) => impl.all(sql, p),
    run: (...p) => impl.run(sql, p),
  }),
  exec: (sql) => impl.exec(sql),
  tx: (fn) => impl.tx(fn),
  addColumn: (t, d) => impl.addColumn(t, d),
  end: () => impl.end(),
};

// ---------- схема ----------
// tenants — рабочие пространства: компания (company), личный учёт (personal), демо (demo, только чтение).
// Все данные компании (подразделения, пользователи, отчёты, записи) привязаны к tenant и изолированы друг от друга.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('company','personal','demo')),
  industry TEXT NOT NULL DEFAULT 'university',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (tenant_id, key)
);
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  type TEXT NOT NULL,
  building TEXT,
  match_key TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('resp','reviewer','admin','manager','personal')),
  org_id INTEGER REFERENCES organizations(id),
  active INTEGER NOT NULL DEFAULT 1,
  tg_chat_id TEXT,
  lang TEXT NOT NULL DEFAULT 'ru',
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  role TEXT NOT NULL,
  org_id INTEGER REFERENCES organizations(id),
  created_by INTEGER REFERENCES users(id),
  expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  uses INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disposal_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_recycling INTEGER NOT NULL DEFAULT 0,
  co2_factor REAL,
  rank INTEGER NOT NULL DEFAULT 5,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS waste_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER REFERENCES organizations(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('кг','л')),
  kg_per_unit REAL NOT NULL DEFAULT 1,
  category TEXT NOT NULL DEFAULT 'organic',
  default_method_id INTEGER REFERENCES disposal_methods(id),
  recommended_method_id INTEGER REFERENCES disposal_methods(id),
  recyclable INTEGER NOT NULL DEFAULT 0,
  co2_factor REAL NOT NULL DEFAULT 0.70021,
  note TEXT,
  max_per_entry REAL NOT NULL DEFAULT 200,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','in_review','accepted','returned')),
  submitted_at TEXT,
  reviewer_id INTEGER REFERENCES users(id),
  decided_at TEXT,
  last_comment TEXT,
  UNIQUE (org_id, period)
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  name_kz TEXT,
  synonyms TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'plate',
  price_kzt_kg REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  date TEXT NOT NULL,
  waste_type_id INTEGER NOT NULL REFERENCES waste_types(id),
  qty REAL NOT NULL CHECK (qty > 0),
  method_id INTEGER NOT NULL REFERENCES disposal_methods(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  photo TEXT,
  note TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  product_id INTEGER REFERENCES products(id),
  client_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_report ON entries(report_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_client ON entries(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scale_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_hint TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS tg_links (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, kind TEXT, text TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS org_goals (
  org_id INTEGER PRIMARY KEY REFERENCES organizations(id),
  reduce_pct REAL NOT NULL DEFAULT 10,
  diverted_pct REAL NOT NULL DEFAULT 30,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  date TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  cooked_kg REAL NOT NULL CHECK (cooked_kg >= 0),
  leftover_kg REAL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (org_id, date, product_id)
);
CREATE INDEX IF NOT EXISTS idx_production_org_date ON production(org_id, date);
CREATE INDEX IF NOT EXISTS idx_orgs_tenant ON organizations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
`;

let ready = null;
// создаёт таблицы один раз; вызывается при старте сервера/скриптов
function init() {
  ready ??= (async () => {
    for (const stmt of impl.ddl(SCHEMA).split(';').map((x) => x.trim()).filter(Boolean)) await impl.exec(stmt);
  })();
  return ready;
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `scrypt$${salt}$${h}`;
}
function checkPassword(pw, stored) {
  const [, salt, h] = String(stored).split('$');
  if (!salt || !h) return false;
  const calc = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'));
}

const nowIso = () => new Date().toISOString();

module.exports = { db, init, hashPassword, checkPassword, nowIso, IS_PG };
