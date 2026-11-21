'use strict';
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'socialdesk.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5b5bd6',
  bio_slug TEXT UNIQUE,
  bio_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  network TEXT NOT NULL,
  name TEXT NOT NULL,
  handle TEXT,
  avatar TEXT,
  credentials TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  overrides TEXT NOT NULL DEFAULT '{}',
  media_ids TEXT NOT NULL DEFAULT '[]',
  scheduled_at INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS post_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  remote_id TEXT,
  remote_url TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER,
  published_at INTEGER,
  likes INTEGER, comments INTEGER, shares INTEGER, views INTEGER,
  metrics_at INTEGER
);
CREATE TABLE IF NOT EXISTS account_stats (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  followers INTEGER, following INTEGER, posts_count INTEGER,
  PRIMARY KEY (account_id, day)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  brand_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mastodon_apps (
  instance TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  PRIMARY KEY (instance, redirect_uri)
);
CREATE INDEX IF NOT EXISTS idx_posts_brand ON posts(brand_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_targets_post ON post_targets(post_id);
`);

// ---- migrations for databases created by earlier versions ----
const cols = t => db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
if (!cols('users').includes('org_id')) db.exec('ALTER TABLE users ADD COLUMN org_id INTEGER REFERENCES orgs(id) ON DELETE CASCADE');
if (!cols('users').includes('is_super')) db.exec('ALTER TABLE users ADD COLUMN is_super INTEGER NOT NULL DEFAULT 0');
if (!cols('brands').includes('org_id')) db.exec('ALTER TABLE brands ADD COLUMN org_id INTEGER REFERENCES orgs(id) ON DELETE CASCADE');
if (!cols('accounts').includes('remote_key')) db.exec('ALTER TABLE accounts ADD COLUMN remote_key TEXT');
if (db.prepare('SELECT 1 FROM users WHERE org_id IS NULL LIMIT 1').get() || db.prepare('SELECT 1 FROM brands WHERE org_id IS NULL LIMIT 1').get()) {
  let org = db.prepare('SELECT id FROM orgs ORDER BY id LIMIT 1').get();
  if (!org) org = { id: Number(db.prepare('INSERT INTO orgs(name, created_at) VALUES(?, ?)').run('My Company', Date.now()).lastInsertRowid) };
  db.prepare('UPDATE users SET org_id = ? WHERE org_id IS NULL').run(org.id);
  db.prepare('UPDATE brands SET org_id = ? WHERE org_id IS NULL').run(org.id);
  db.prepare("UPDATE users SET role = 'owner' WHERE role = 'admin' AND org_id = ?").run(org.id);
}
if (!db.prepare('SELECT 1 FROM users WHERE is_super = 1').get()) db.exec('UPDATE users SET is_super = 1 WHERE id = (SELECT MIN(id) FROM users)');
db.exec('CREATE INDEX IF NOT EXISTS idx_brands_org ON brands(org_id); CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);');

// ---- credential encryption (AES-256-GCM). Key from SECRET_KEY env or data/secret.key ----
const keyFile = path.join(DATA_DIR, 'secret.key');
let keyHex = process.env.SECRET_KEY;
if (!keyHex) {
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  keyHex = fs.readFileSync(keyFile, 'utf8').trim();
}
const KEY = /^[0-9a-f]{64}$/i.test(keyHex) ? Buffer.from(keyHex, 'hex') : crypto.createHash('sha256').update(keyHex).digest();

function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(str) {
  const [iv, tag, enc] = str.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
}

function getSetting(key, def = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : def;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

module.exports = { db, DATA_DIR, UPLOAD_DIR, encrypt, decrypt, getSetting, setSetting };
