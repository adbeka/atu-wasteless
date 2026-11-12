// База данных: SQLite (встроенный модуль node:sqlite, Node >= 22.13)
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'waste.db');
require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  short TEXT NOT NULL,
  type TEXT NOT NULL,            -- кафедра / столовая / кофейня / гостиница / лаборатория
  building TEXT,
  match_key TEXT,                -- ключ для сопоставления со столбцом «Организации» в справочнике Excel
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('resp','reviewer','admin','manager')),
  org_id INTEGER REFERENCES organizations(id),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS disposal_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                          -- TBO, COMPOST, AD, RECYCLE, OIL, FEED, DONATE …
  name TEXT NOT NULL UNIQUE,
  is_recycling INTEGER NOT NULL DEFAULT 0,   -- 1 = отход уходит не на полигон (переработка, компост, передача)
  co2_factor REAL,                           -- кг CO2e на кг; NULL для полигона (зависит от вида) или если коэффициента нет
  rank INTEGER NOT NULL DEFAULT 5,           -- иерархия обращения с отходами: 1 — лучше (предотвращение), 5 — захоронение
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS waste_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER REFERENCES organizations(id),  -- NULL = общий вид
  name TEXT NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('кг','л')),
  kg_per_unit REAL NOT NULL DEFAULT 1,           -- для л: плотность
  category TEXT NOT NULL DEFAULT 'organic',      -- organic / recyclable / special / mixed
  default_method_id INTEGER REFERENCES disposal_methods(id),   -- как сейчас утилизируют (из образцов)
  recommended_method_id INTEGER REFERENCES disposal_methods(id), -- рекомендуемый способ из справочника
  recyclable INTEGER NOT NULL DEFAULT 0,         -- 2 = да, 1 = частично, 0 = нет
  co2_factor REAL NOT NULL DEFAULT 0.70021,      -- кг CO2-экв на кг при вывозе ТБО на полигон (DEFRA 2024)
  note TEXT,
  max_per_entry REAL NOT NULL DEFAULT 200,       -- разумный верхний предел одной записи
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  period TEXT NOT NULL,                 -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','in_review','accepted','returned')),
  submitted_at TEXT,
  reviewer_id INTEGER REFERENCES users(id),
  decided_at TEXT,
  last_comment TEXT,
  UNIQUE (org_id, period)
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
  source TEXT NOT NULL DEFAULT 'manual',   -- manual (форма), voice (фраза/голос), scale (электронные весы)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_report ON entries(report_id);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  comment TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS scale_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,     -- токен устройства хранится только как хэш
  token_hint TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
`);


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

// Telegram: привязка аккаунта к чату (миграция для уже созданных баз)
try { db.exec('ALTER TABLE users ADD COLUMN tg_chat_id TEXT'); } catch { /* колонка уже есть */ }
db.exec('CREATE TABLE IF NOT EXISTS tg_links (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL)');

const nowIso = () => new Date().toISOString();

module.exports = { db, hashPassword, checkPassword, nowIso };
