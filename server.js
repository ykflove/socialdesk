'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { db, UPLOAD_DIR, encrypt, getSetting, setSetting } = require('./src/db');
const { networks, publicInfo } = require('./src/networks');
const apps = require('./src/apps');
const oauth = require('./src/oauth');
const scheduler = require('./src/scheduler');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_MB || 512) * 1024 * 1024;
const SECURE_COOKIE = /^https:/.test(process.env.PUBLIC_URL || '') ? '; Secure' : '';

// ---------------- helpers ----------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm' };

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, s = 400) => { throw new HttpError(s, msg); };

function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
const redirect = (res, to) => { res.writeHead(302, { Location: to }); res.end(); };

async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 5e6) bad('Body too large', 413); chunks.push(c); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { bad('Invalid JSON'); }
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=')).filter(p => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const h = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions(token, user_id, expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + 30 * 86400_000);
  res.setHeader('Set-Cookie', `sd_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${SECURE_COOKIE}`);
}
function currentUser(req) {
  const t = parseCookies(req).sd_session;
  if (!t) return null;
  return db.prepare(`SELECT u.id, u.email, u.name, u.role, u.org_id, u.is_super, o.name AS org_name FROM sessions s
    JOIN users u ON u.id = s.user_id JOIN orgs o ON o.id = u.org_id WHERE s.token = ? AND s.expires_at > ?`).get(t, Date.now()) || null;
}
const isOrgAdmin = u => u.role === 'owner' || u.role === 'admin';
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'brand';
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const signupOpen = () => getSetting('allow_signup', process.env.ALLOW_SIGNUP === '0' ? '0' : '1') === '1';

// simple in-memory rate limiter (per IP + bucket)
const hits = new Map();
function limit(req, bucket, max, windowMs) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  const k = bucket + ':' + ip, now = Date.now();
  const h = (hits.get(k) || []).filter(t => now - t < windowMs);
  if (h.length >= max) bad('Too many attempts. Please wait a few minutes.', 429);
  h.push(now); hits.set(k, h);
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600_000)) hits.delete(k); }, 600_000).unref();

// ---- tenant-scoped lookups: everything is checked against the user's organisation ----
function brandFor(id, user) {
  const b = db.prepare('SELECT * FROM brands WHERE id = ? AND org_id = ?').get(Number(id), user.org_id);
  if (!b) bad('Brand not found', 404);
  return b;
}
function accountFor(id, user) {
  const a = db.prepare('SELECT a.* FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.id = ? AND b.org_id = ?').get(Number(id), user.org_id);
  if (!a) bad('Account not found', 404);
  return a;
}
function postFor(id, user) {
  const p = db.prepare('SELECT p.* FROM posts p JOIN brands b ON b.id = p.brand_id WHERE p.id = ? AND b.org_id = ?').get(Number(id), user.org_id);
  if (!p) bad('Post not found', 404);
  return p;
}
function accountView(a) {
  const n = networks[a.network];
  return { id: a.id, brand_id: a.brand_id, network: a.network, name: a.name, handle: a.handle, avatar: a.avatar, status: a.status, last_error: a.last_error, label: n?.label, color: n?.color, manual: !!n?.manual };
}
function postView(p) {
  const targets = db.prepare(`SELECT t.*, a.network, a.name AS account_name FROM post_targets t JOIN accounts a ON a.id = t.account_id WHERE t.post_id = ?`).all(p.id);
  const mediaIds = JSON.parse(p.media_ids);
  const media = mediaIds.length ? db.prepare(`SELECT id, filename, mime, original_name, size FROM media WHERE brand_id = ? AND id IN (${mediaIds.map(() => '?').join(',')})`).all(p.brand_id, ...mediaIds) : [];
  const order = Object.fromEntries(mediaIds.map((id, i) => [id, i]));
  media.sort((a, b) => order[a.id] - order[b.id]);
  return { ...p, overrides: JSON.parse(p.overrides), media_ids: mediaIds, media, targets };
}
function newBrand(orgId, name, color) {
  let slug = slugify(name);
  while (db.prepare('SELECT 1 FROM brands WHERE bio_slug = ?').get(slug)) slug = slugify(name).slice(0, 34) + '-' + crypto.randomBytes(2).toString('hex');
  return Number(db.prepare('INSERT INTO brands(org_id, name, color, bio_slug, created_at) VALUES(?,?,?,?,?)').run(orgId, name, color || '#5b5bd6', slug, Date.now()).lastInsertRowid);
}
// insert or update (same network + same remote profile in a brand → update the credentials)
function upsertAccount(brandId, acc) {
  const ex = acc.remoteKey && db.prepare('SELECT id FROM accounts WHERE brand_id = ? AND network = ? AND remote_key = ?').get(brandId, acc.network, acc.remoteKey);
  if (ex) {
    db.prepare("UPDATE accounts SET name=?, handle=?, avatar=?, credentials=?, status='ok', last_error=NULL WHERE id=?").run(acc.name, acc.handle, acc.avatar, encrypt(acc.creds), ex.id);
    return ex.id;
  }
  return Number(db.prepare('INSERT INTO accounts(brand_id, network, name, handle, avatar, credentials, remote_key, created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(brandId, acc.network, acc.name, acc.handle, acc.avatar, encrypt(acc.creds), acc.remoteKey || null, Date.now()).lastInsertRowid);
}

// ---------------- router ----------------
const routes = [];
// level: 'public' | 'user' | 'admin' (org owner/admin) | 'super' (platform admin)
const route = (method, pattern, handler, level = 'user') => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, level });
};

// ---- auth ----
route('GET', '/api/setup-status', () => {
  const hasUsers = !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
  return { needsSetup: !hasUsers, allowSignup: !hasUsers || signupOpen() };
}, 'public');

route('POST', '/api/signup', async (req, res) => {
  limit(req, 'signup', 10, 3600_000);
  const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (!first && !signupOpen()) bad('Sign-up is closed on this server. Ask your administrator for an account.', 403);
  const { company, name, email, password } = await readJson(req);
  const em = String(email || '').toLowerCase().trim();
  if (!name || !validEmail(em) || !password || password.length < 8) bad('Name, a valid email and a password of at least 8 characters are required');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) bad('An account with this email already exists. Log in instead.');
  const now = Date.now();
  const orgName = String(company || '').trim() || `${String(name).trim()}'s company`;
  const orgId = Number(db.prepare('INSERT INTO orgs(name, created_at) VALUES(?, ?)').run(orgName.slice(0, 80), now).lastInsertRowid);
  const uid = Number(db.prepare('INSERT INTO users(org_id, email, name, pass_hash, role, is_super, created_at) VALUES(?,?,?,?,?,?,?)')
    .run(orgId, em, String(name).trim().slice(0, 80), hashPassword(password), 'owner', first ? 1 : 0, now).lastInsertRowid);
  newBrand(orgId, orgName.slice(0, 60));
  createSession(res, uid);
  return { ok: true };
}, 'public');

route('POST', '/api/login', async (req, res) => {
  limit(req, 'login', 20, 15 * 60_000);
  const { email, password } = await readJson(req);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  if (!u || !checkPassword(String(password || ''), u.pass_hash)) bad('Wrong email or password', 401);
  createSession(res, u.id);
  return { ok: true };
}, 'public');

route('POST', '/api/logout', (req, res) => {
  const t = parseCookies(req).sd_session;
  if (t) db.prepare('DELETE FROM sessions WHERE token = ?').run(t);
  res.setHeader('Set-Cookie', `sd_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIE}`);
  return { ok: true };
}, 'public');
route('GET', '/api/me', req => ({ ...req.user, is_super: !!req.user.is_super }));
route('PUT', '/api/me/password', async (req) => {
  const { current, next } = await readJson(req);
  const u = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(req.user.id);
  if (!checkPassword(String(current || ''), u.pass_hash)) bad('Current password is wrong');
  if (!next || next.length < 8) bad('New password must be 8+ characters');
  db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, parseCookies(req).sd_session);
  return { ok: true };
});

// ---- organisation & team ----
route('PUT', '/api/org', async (req) => {
  const { name } = await readJson(req);
  if (!name) bad('Name required');
  db.prepare('UPDATE orgs SET name = ? WHERE id = ?').run(String(name).slice(0, 80), req.user.org_id);
  return { ok: true };
}, 'admin');
route('GET', '/api/users', req => db.prepare('SELECT id, email, name, role, created_at FROM users WHERE org_id = ? ORDER BY id').all(req.user.org_id), 'admin');
route('POST', '/api/users', async (req) => {
  const { name, email, password, role } = await readJson(req);
  const em = String(email || '').toLowerCase().trim();
  if (!name || !validEmail(em) || !password || password.length < 8) bad('Name, valid email and an 8+ character password are required');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(em)) bad('That email is already used');
  db.prepare('INSERT INTO users(org_id, email, name, pass_hash, role, created_at) VALUES(?,?,?,?,?,?)').run(req.user.org_id, em, name, hashPassword(password), role === 'admin' ? 'admin' : 'editor', Date.now());
  return { ok: true };
}, 'admin');
route('DELETE', '/api/users/:id', (req, res, p) => {
  if (Number(p.id) === req.user.id) bad('You cannot delete yourself');
  const u = db.prepare('SELECT role FROM users WHERE id = ? AND org_id = ?').get(Number(p.id), req.user.org_id);
  if (!u) bad('Not found', 404);
  if (u.role === 'owner') bad('The owner cannot be removed');
  db.prepare('DELETE FROM users WHERE id = ?').run(Number(p.id));
  return { ok: true };
}, 'admin');

// ---- platform (server-wide) settings: super admin only ----
route('GET', '/api/platform', () => ({
  public_url: process.env.PUBLIC_URL || getSetting('public_url', ''), public_url_from_env: !!process.env.PUBLIC_URL,
  allow_signup: signupOpen(),
  stats: { orgs: db.prepare('SELECT COUNT(*) n FROM orgs').get().n, users: db.prepare('SELECT COUNT(*) n FROM users').get().n, accounts: db.prepare('SELECT COUNT(*) n FROM accounts').get().n, posts: db.prepare("SELECT COUNT(*) n FROM post_targets WHERE status='published'").get().n },
  integrations: Object.entries(apps.PROVIDERS).map(([id, p]) => {
    const a = apps.get(id);
    return { id, label: p.label, portal: p.portal, steps: p.steps, networks: p.networks, configured: !!a, source: a?.source || null, clientId: a?.clientId || '', redirectUri: `${scheduler.publicBase()}/api/oauth/callback/${id}`, env: p.env };
  }),
}), 'super');
route('PUT', '/api/platform', async (req) => {
  const b = await readJson(req);
  if ('public_url' in b) {
    const v = String(b.public_url || '').trim().replace(/\/$/, '');
    if (v && !/^https?:\/\/[^/]+$/.test(v)) bad('Public URL must look like https://social.example.com (no path)');
    setSetting('public_url', v);
  }
  if ('allow_signup' in b) setSetting('allow_signup', b.allow_signup ? '1' : '0');
  if (b.integration) {
    const { id, clientId, clientSecret, clear } = b.integration;
    if (!apps.PROVIDERS[id]) bad('Unknown integration');
    if (clear) apps.set(id, '', '');
    else { if (!clientId && !apps.get(id)) bad('Client ID and secret are required'); apps.set(id, String(clientId || '').trim(), String(clientSecret || '').trim()); }
  }
  return { ok: true };
}, 'super');

route('GET', '/api/networks', () => publicInfo(), 'public');
route('GET', '/api/config', () => ({ public_url: scheduler.publicBase(), has_public_url: !!(process.env.PUBLIC_URL || getSetting('public_url')) }));

// ---- brands ----
route('GET', '/api/brands', req => db.prepare(`SELECT b.id, b.name, b.color, b.bio_slug,
  (SELECT COUNT(*) FROM accounts a WHERE a.brand_id = b.id) AS account_count FROM brands b WHERE b.org_id = ? ORDER BY b.id`).all(req.user.org_id));
route('POST', '/api/brands', async (req) => {
  const { name, color } = await readJson(req);
  if (!name) bad('Name required');
  return { id: newBrand(req.user.org_id, String(name).slice(0, 60), color) };
});
route('PUT', '/api/brands/:id', async (req, res, p) => {
  const b = brandFor(p.id, req.user);
  const { name, color } = await readJson(req);
  db.prepare('UPDATE brands SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ?').run(name || null, /^#[0-9a-f]{6}$/i.test(color) ? color : null, b.id);
  return { ok: true };
});
route('DELETE', '/api/brands/:id', (req, res, p) => {
  const b = brandFor(p.id, req.user);
  if (db.prepare('SELECT COUNT(*) AS n FROM brands WHERE org_id = ?').get(req.user.org_id).n <= 1) bad('You need at least one brand');
  const files = db.prepare('SELECT filename FROM media WHERE brand_id = ?').all(b.id);
  db.prepare('DELETE FROM brands WHERE id = ?').run(b.id);
  for (const f of files) fs.rm(path.join(UPLOAD_DIR, f.filename), () => { });
  return { ok: true };
}, 'admin');

// ---- accounts ----
route('GET', '/api/brands/:id/accounts', (req, res, p) =>
  db.prepare('SELECT * FROM accounts WHERE brand_id = ? ORDER BY id').all(brandFor(p.id, req.user).id).map(accountView));

route('POST', '/api/accounts', async (req) => {
  const { brand_id, network, credentials } = await readJson(req);
  const b = brandFor(brand_id, req.user);
  const net = networks[network];
  if (!net) bad('Unknown network');
  const creds = {};
  for (const f of net.fields) { const v = String(credentials?.[f.key] ?? '').trim(); if (v) creds[f.key] = v; }
  let info;
  try { info = await net.verify(creds); } catch (e) { bad(`Could not connect to ${net.label}: ${e.message}`); }
  const id = upsertAccount(b.id, { network, name: info.name, handle: info.handle, avatar: info.avatar, creds, remoteKey: net.manual ? null : info.handle });
  scheduler.collectAnalytics(id).catch(() => { });
  return { id };
});
route('PUT', '/api/accounts/:id', async (req, res, p) => {
  const acc = scheduler.loadAccount(accountFor(p.id, req.user).id);
  const net = networks[acc.network];
  const { credentials } = await readJson(req);
  const creds = { ...acc.creds };
  for (const f of net.fields) { const v = String(credentials?.[f.key] ?? '').trim(); if (v) creds[f.key] = v; }
  let info;
  try { info = await net.verify(creds); } catch (e) { bad(`Could not connect to ${net.label}: ${e.message}`); }
  db.prepare("UPDATE accounts SET name=?, handle=?, avatar=?, credentials=?, status='ok', last_error=NULL WHERE id=?").run(info.name, info.handle, info.avatar, encrypt(creds), acc.id);
  return { ok: true };
});
route('DELETE', '/api/accounts/:id', (req, res, p) => { db.prepare('DELETE FROM accounts WHERE id = ?').run(accountFor(p.id, req.user).id); return { ok: true }; });

// ---- one-click OAuth connect ----
// GET /api/oauth/start/:provider?brand=1[&instance=mastodon.social]  → redirects to the network's login page
route('GET', '/api/oauth/start/:provider', async (req, res, p, q) => {
  const b = brandFor(q.get('brand'), req.user);
  const redirectUri = `${scheduler.publicBase()}/api/oauth/callback/${p.provider}`;
  try {
    const s = await oauth.start(p.provider, redirectUri, { instance: q.get('instance') });
    db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(Date.now() - 30 * 60_000);
    db.prepare('INSERT INTO oauth_states(state, user_id, brand_id, provider, data, created_at) VALUES(?,?,?,?,?,?)').run(s.state, req.user.id, b.id, p.provider, JSON.stringify(s.data), Date.now());
    redirect(res, s.url);
  } catch (e) { redirect(res, '/#/accounts?error=' + encodeURIComponent(e.message)); }
}, 'redirect');

route('GET', '/api/oauth/callback/:provider', async (req, res, p, q) => {
  const back = (k, v) => redirect(res, `/#/accounts?${k}=${encodeURIComponent(v)}`);
  const st = db.prepare('SELECT * FROM oauth_states WHERE state = ? AND provider = ?').get(String(q.get('state') || ''), p.provider);
  if (st) db.prepare('DELETE FROM oauth_states WHERE state = ?').run(st.state);
  if (!st || Date.now() - st.created_at > 30 * 60_000) return back('error', 'This login link expired. Please click Connect again.');
  if (!req.user || req.user.id !== st.user_id) return back('error', 'Please log in to Socialdesk in this browser, then connect again.');
  const err = q.get('error_description') || q.get('error_message') || q.get('error');
  if (err) return back('error', `${p.provider}: ${err}`);
  const code = q.get('code');
  if (!code) return back('error', 'No authorization code was returned.');
  try {
    const list = await oauth.callback(p.provider, code, `${scheduler.publicBase()}/api/oauth/callback/${p.provider}`, JSON.parse(st.data));
    const ids = list.map(a => upsertAccount(st.brand_id, a));
    for (const id of ids) scheduler.collectAnalytics(id).catch(() => { });
    return back('connected', list.map(a => a.name).join(', '));
  } catch (e) { return back('error', e.message); }
}, 'redirect');

// ---- media ----
route('GET', '/api/brands/:id/media', (req, res, p) =>
  db.prepare('SELECT * FROM media WHERE brand_id = ? ORDER BY id DESC LIMIT 300').all(brandFor(p.id, req.user).id));
route('POST', '/api/brands/:id/media', async (req, res, p) => {
  const b = brandFor(p.id, req.user);
  const name = decodeURIComponent(req.headers['x-filename'] || '');
  if (!name) bad('X-Filename header required');
  const mime = String(req.headers['content-type'] || '').split(';')[0];
  const ext = EXT[mime];
  if (!ext) bad('Only JPG, PNG, GIF, WEBP, MP4, MOV and WEBM files are supported');
  const filename = crypto.randomBytes(16).toString('hex') + ext;
  const dest = path.join(UPLOAD_DIR, filename);
  const out = fs.createWriteStream(dest);
  let size = 0;
  try {
    for await (const c of req) {
      size += c.length;
      if (size > MAX_UPLOAD) bad(`File too large (max ${MAX_UPLOAD / 1048576} MB)`, 413);
      if (!out.write(c)) await new Promise(r => out.once('drain', r));
    }
    await new Promise((r, j) => out.end(e => e ? j(e) : r()));
  } catch (e) { out.destroy(); fs.rm(dest, () => { }); throw e; }
  const r = db.prepare('INSERT INTO media(brand_id, filename, original_name, mime, size, created_at) VALUES(?,?,?,?,?,?)').run(b.id, filename, name.slice(0, 200), mime, size, Date.now());
  return db.prepare('SELECT * FROM media WHERE id = ?').get(Number(r.lastInsertRowid));
});
route('DELETE', '/api/media/:id', (req, res, p) => {
  const m = db.prepare('SELECT m.* FROM media m JOIN brands b ON b.id = m.brand_id WHERE m.id = ? AND b.org_id = ?').get(Number(p.id), req.user.org_id);
  if (m) { db.prepare('DELETE FROM media WHERE id = ?').run(m.id); fs.rm(path.join(UPLOAD_DIR, m.filename), () => { }); }
  return { ok: true };
});

// ---- posts ----
route('GET', '/api/brands/:id/posts', (req, res, p, q) => {
  const bid = brandFor(p.id, req.user).id;
  const from = Number(q.get('from') || 0), to = Number(q.get('to') || 8.64e15);
  const status = q.get('status');
  let rows;
  if (status === 'draft') rows = db.prepare("SELECT * FROM posts WHERE brand_id = ? AND status = 'draft' ORDER BY updated_at DESC").all(bid);
  else if (status === 'queue') rows = db.prepare("SELECT * FROM posts WHERE brand_id = ? AND status IN ('scheduled','publishing') ORDER BY scheduled_at").all(bid);
  else if (status === 'history') rows = db.prepare("SELECT * FROM posts WHERE brand_id = ? AND status IN ('published','partial','failed') ORDER BY scheduled_at DESC LIMIT 200").all(bid);
  else rows = db.prepare('SELECT * FROM posts WHERE brand_id = ? AND scheduled_at BETWEEN ? AND ? ORDER BY scheduled_at').all(bid, from, to);
  return rows.map(postView);
});
route('GET', '/api/posts/:id', (req, res, p) => postView(postFor(p.id, req.user)));

function savePost(body, existing, user) {
  const brandId = existing ? existing.brand_id : brandFor(body.brand_id, user).id;
  const accountIds = [...new Set((body.account_ids || []).map(Number))];
  const valid = accountIds.length ? db.prepare(`SELECT id FROM accounts WHERE brand_id = ? AND id IN (${accountIds.map(() => '?').join(',')})`).all(brandId, ...accountIds).map(r => r.id) : [];
  const mode = body.mode || 'draft';
  if (mode !== 'draft' && !valid.length) bad('Pick at least one account');
  const text = String(body.text || '');
  const mediaReq = (body.media_ids || []).map(Number).filter(Boolean);
  const mediaOk = new Set(mediaReq.length ? db.prepare(`SELECT id FROM media WHERE brand_id = ? AND id IN (${mediaReq.map(() => '?').join(',')})`).all(brandId, ...mediaReq).map(r => r.id) : []);
  const mediaIds = mediaReq.filter(id => mediaOk.has(id));
  if (mode !== 'draft' && !text.trim() && !mediaIds.length) bad('Write something or add media');
  const scheduledAt = mode === 'now' ? Date.now() : Number(body.scheduled_at) || null;
  if (mode === 'schedule' && !scheduledAt) bad('Pick a date and time');
  const status = mode === 'draft' ? 'draft' : 'scheduled';
  const overrides = {};
  for (const [k, v] of Object.entries(body.overrides || {})) if (valid.includes(Number(k)) && v != null && v !== '') overrides[k] = String(v);
  const now = Date.now();
  let id;
  if (existing) {
    if (['published', 'publishing'].includes(existing.status)) bad('This post was already published and cannot be edited');
    db.prepare('UPDATE posts SET text=?, overrides=?, media_ids=?, scheduled_at=?, status=?, updated_at=? WHERE id=?').run(text, JSON.stringify(overrides), JSON.stringify(mediaIds), scheduledAt, status, now, existing.id);
    id = existing.id;
    db.prepare("DELETE FROM post_targets WHERE post_id = ? AND status != 'published'").run(id);
  } else {
    id = Number(db.prepare('INSERT INTO posts(brand_id, text, overrides, media_ids, scheduled_at, status, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(brandId, text, JSON.stringify(overrides), JSON.stringify(mediaIds), scheduledAt, status, user.id, now, now).lastInsertRowid);
  }
  const already = new Set(db.prepare('SELECT account_id FROM post_targets WHERE post_id = ?').all(id).map(r => r.account_id));
  const ins = db.prepare('INSERT INTO post_targets(post_id, account_id) VALUES(?, ?)');
  for (const a of valid) if (!already.has(a)) ins.run(id, a);
  if (mode === 'now') setTimeout(scheduler.tick, 50);
  return postView(db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
}
route('POST', '/api/posts', async (req) => savePost(await readJson(req), null, req.user));
route('PUT', '/api/posts/:id', async (req, res, p) => { const ex = postFor(p.id, req.user); return savePost(await readJson(req), ex, req.user); });
route('PATCH', '/api/posts/:id/move', async (req, res, p) => {
  const ex = postFor(p.id, req.user);
  const { scheduled_at } = await readJson(req);
  if (!['scheduled', 'draft'].includes(ex.status)) bad('Only scheduled posts and drafts can be moved');
  db.prepare('UPDATE posts SET scheduled_at = ?, updated_at = ? WHERE id = ?').run(Number(scheduled_at), Date.now(), ex.id);
  return { ok: true };
});
route('DELETE', '/api/posts/:id', (req, res, p) => { db.prepare('DELETE FROM posts WHERE id = ?').run(postFor(p.id, req.user).id); return { ok: true }; });
route('POST', '/api/posts/:id/retry', (req, res, p) => {
  const id = postFor(p.id, req.user).id;
  db.prepare("UPDATE post_targets SET status='pending', attempts=0, retry_at=NULL, error=NULL WHERE post_id=? AND status='failed'").run(id);
  db.prepare("UPDATE posts SET status='scheduled', scheduled_at=MIN(COALESCE(scheduled_at, ?), ?) WHERE id=?").run(Date.now(), Date.now(), id);
  setTimeout(scheduler.tick, 50);
  return { ok: true };
});
route('POST', '/api/posts/:id/duplicate', (req, res, p) => {
  const ex = postFor(p.id, req.user);
  const now = Date.now();
  const id = Number(db.prepare("INSERT INTO posts(brand_id, text, overrides, media_ids, scheduled_at, status, created_by, created_at, updated_at) VALUES(?,?,?,?,NULL,'draft',?,?,?)")
    .run(ex.brand_id, ex.text, ex.overrides, ex.media_ids, req.user.id, now, now).lastInsertRowid);
  for (const t of db.prepare('SELECT account_id FROM post_targets WHERE post_id = ?').all(ex.id)) db.prepare('INSERT INTO post_targets(post_id, account_id) VALUES(?,?)').run(id, t.account_id);
  return { id };
});

// ---- reminders (manual networks) ----
route('GET', '/api/brands/:id/reminders', (req, res, p) => db.prepare(`
  SELECT t.id AS target_id, t.account_id, t.published_at AS due_at, a.network, a.name AS account_name, p.id AS post_id
  FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN accounts a ON a.id = t.account_id
  WHERE p.brand_id = ? AND t.status = 'manual' ORDER BY t.published_at`).all(brandFor(p.id, req.user).id).map(r => {
  const post = postView(db.prepare('SELECT * FROM posts WHERE id = ?').get(r.post_id));
  return { ...r, text: post.overrides[r.account_id] ?? post.text, media: post.media };
}));
route('POST', '/api/targets/:id/done', async (req, res, p) => {
  const { url } = await readJson(req);
  const t = db.prepare('SELECT t.* FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN brands b ON b.id = p.brand_id WHERE t.id = ? AND b.org_id = ?').get(Number(p.id), req.user.org_id);
  if (!t) bad('Not found', 404);
  db.prepare("UPDATE post_targets SET status='published', remote_url=?, published_at=? WHERE id=?").run(/^https?:\/\//.test(url || '') ? url : null, Date.now(), t.id);
  scheduler.refreshPostStatus(t.post_id);
  return { ok: true };
});

// ---- analytics ----
function analytics(brandId, days) {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const prevSince = new Date(Date.now() - 2 * days * 86400_000).toISOString().slice(0, 10);
  const accs = db.prepare('SELECT * FROM accounts WHERE brand_id = ?').all(brandId);
  const accounts = accs.map(a => {
    const series = db.prepare('SELECT day, followers, following, posts_count FROM account_stats WHERE account_id = ? AND day >= ? ORDER BY day').all(a.id, since);
    const before = db.prepare('SELECT followers FROM account_stats WHERE account_id = ? AND day < ? AND day >= ? ORDER BY day DESC LIMIT 1').get(a.id, since, prevSince);
    const last = series[series.length - 1];
    const first = before || series[0];
    return { ...accountView(a), series, followers: last?.followers ?? null, change: last && first && last.followers != null && first.followers != null ? last.followers - first.followers : null };
  });
  const sinceMs = Date.now() - days * 86400_000;
  const posts = db.prepare(`SELECT t.id, t.post_id, t.published_at, t.likes, t.comments, t.shares, t.views, t.remote_url, a.network, a.name AS account_name, p.text, p.media_ids
    FROM post_targets t JOIN posts p ON p.id = t.post_id JOIN accounts a ON a.id = t.account_id
    WHERE p.brand_id = ? AND t.status = 'published' AND t.published_at >= ? ORDER BY t.published_at DESC`).all(brandId, sinceMs)
    .map(r => ({ ...r, engagement: (r.likes || 0) + (r.comments || 0) + (r.shares || 0), thumb: (() => {
      const ids = JSON.parse(r.media_ids); if (!ids.length) return null;
      const m = db.prepare('SELECT filename, mime FROM media WHERE id = ?').get(ids[0]); return m ? { filename: m.filename, mime: m.mime } : null;
    })(), media_ids: undefined }));
  const all = db.prepare(`SELECT t.published_at, COALESCE(t.likes,0)+COALESCE(t.comments,0)+COALESCE(t.shares,0) AS e
    FROM post_targets t JOIN posts p ON p.id = t.post_id WHERE p.brand_id = ? AND t.status='published' AND t.metrics_at IS NOT NULL`).all(brandId);
  const sum = k => posts.reduce((s, r) => s + (r[k] || 0), 0);
  const totals = {
    posts: posts.length, likes: sum('likes'), comments: sum('comments'), shares: sum('shares'), views: sum('views'),
    followers: accounts.reduce((s, a) => s + (a.followers || 0), 0), followerChange: accounts.reduce((s, a) => s + (a.change || 0), 0),
    scheduled: db.prepare("SELECT COUNT(*) AS n FROM posts WHERE brand_id = ? AND status = 'scheduled'").get(brandId).n,
  };
  return { accounts, posts, published: all.map(r => [r.published_at, r.e]), totals };
}
route('GET', '/api/brands/:id/analytics', (req, res, p, q) => analytics(brandFor(p.id, req.user).id, Math.min(365, Number(q.get('days') || 30))));
route('POST', '/api/brands/:id/analytics/refresh', async (req, res, p) => {
  limit(req, 'refresh', 30, 3600_000);
  for (const a of db.prepare('SELECT id FROM accounts WHERE brand_id = ?').all(brandFor(p.id, req.user).id)) await scheduler.collectAnalytics(a.id);
  return { ok: true };
});
route('GET', '/api/brands/:id/analytics.csv', (req, res, p, q) => {
  const b = brandFor(p.id, req.user);
  const a = analytics(b.id, Math.min(365, Number(q.get('days') || 30)));
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['published_at', 'network', 'account', 'text', 'likes', 'comments', 'shares', 'views', 'url'].join(',')];
  for (const r of a.posts) lines.push([new Date(r.published_at).toISOString(), r.network, r.account_name, r.text.replace(/\s+/g, ' ').slice(0, 300), r.likes, r.comments, r.shares, r.views, r.remote_url].map(esc).join(','));
  lines.push('', ['day', 'network', 'account', 'followers', 'following', 'posts'].join(','));
  for (const acc of a.accounts) for (const s of acc.series) lines.push([s.day, acc.network, acc.name, s.followers, s.following, s.posts_count].map(esc).join(','));
  send(res, 200, lines.join('\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${slugify(b.name)}-report.csv"` });
});

// ---- link in bio ----
route('GET', '/api/brands/:id/bio', (req, res, p) => { const b = brandFor(p.id, req.user); return { slug: b.bio_slug, ...JSON.parse(b.bio_json) }; });
route('PUT', '/api/brands/:id/bio', async (req, res, p) => {
  const b = brandFor(p.id, req.user);
  const body = await readJson(req);
  const slug = slugify(body.slug || b.bio_slug);
  if (db.prepare('SELECT 1 FROM brands WHERE bio_slug = ? AND id != ?').get(slug, b.id)) bad('That address is taken');
  const avatarOk = body.avatar && db.prepare('SELECT 1 FROM media WHERE brand_id = ? AND filename = ?').get(b.id, body.avatar);
  const data = {
    title: String(body.title || '').slice(0, 80), bio: String(body.bio || '').slice(0, 300),
    avatar: avatarOk ? body.avatar : null, theme: /^#[0-9a-f]{6}$/i.test(body.theme) ? body.theme : '#5b5bd6',
    dark: !!body.dark, showPosts: !!body.showPosts,
    links: (body.links || []).slice(0, 30).map(l => ({ label: String(l.label || '').slice(0, 80), url: String(l.url || '').slice(0, 500) })).filter(l => l.label && /^(https?:|mailto:|tel:)/.test(l.url)),
  };
  db.prepare('UPDATE brands SET bio_slug = ?, bio_json = ? WHERE id = ?').run(slug, JSON.stringify(data), b.id);
  return { ok: true, slug };
});

function bioPage(slug) {
  const b = db.prepare('SELECT * FROM brands WHERE bio_slug = ?').get(slug);
  if (!b) return null;
  const d = { title: b.name, bio: '', links: [], theme: b.color, showPosts: true, ...JSON.parse(b.bio_json) };
  const posts = d.showPosts ? db.prepare(`SELECT p.id, p.media_ids, (SELECT remote_url FROM post_targets WHERE post_id = p.id AND remote_url IS NOT NULL LIMIT 1) AS url
    FROM posts p WHERE p.brand_id = ? AND p.status IN ('published','partial') AND p.media_ids != '[]' ORDER BY p.scheduled_at DESC LIMIT 12`).all(b.id) : [];
  const grid = posts.map(p => {
    const m = db.prepare('SELECT filename, mime FROM media WHERE id = ?').get(JSON.parse(p.media_ids)[0]);
    if (!m) return '';
    const inner = m.mime.startsWith('video/') ? `<video src="/media/${m.filename}" muted playsinline></video>` : `<img src="/media/${m.filename}" alt="" loading="lazy">`;
    return p.url ? `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${inner}</a>` : `<div>${inner}</div>`;
  }).join('');
  const bg = d.dark ? '#111113' : '#f7f7f8', fg = d.dark ? '#eee' : '#1c1c1f';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(d.title || b.name)}</title><meta name="description" content="${escapeHtml(d.bio)}">
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:${bg};color:${fg};display:flex;justify-content:center;padding:48px 16px}
main{width:100%;max-width:520px;text-align:center}.av{width:96px;height:96px;border-radius:50%;object-fit:cover;background:${d.theme};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:40px;font-weight:700}
h1{font-size:22px;margin:16px 0 6px}p{opacity:.75;margin:0 0 28px;line-height:1.5}a.l{display:block;padding:15px 18px;margin:0 0 12px;border-radius:14px;background:${d.theme};color:#fff;text-decoration:none;font-weight:600;transition:transform .15s}
a.l:hover{transform:translateY(-2px)}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:28px}.g img,.g video{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;display:block}
footer{margin-top:36px;font-size:12px;opacity:.45}footer a{color:inherit}</style></head><body><main>
${d.avatar ? `<img class="av" src="/media/${escapeHtml(d.avatar)}" alt="">` : `<div class="av">${escapeHtml((d.title || b.name).slice(0, 1).toUpperCase())}</div>`}
<h1>${escapeHtml(d.title || b.name)}</h1>${d.bio ? `<p>${escapeHtml(d.bio)}</p>` : '<p></p>'}
${d.links.map(l => `<a class="l" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>`).join('')}
${grid ? `<div class="g">${grid}</div>` : ''}<footer>Made with <a href="/">Socialdesk</a> — free &amp; open source</footer></main></body></html>`;
}

// ---------------- server ----------------
function serveStatic(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache || 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
const SEC_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' };

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://x');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Bad URL'); }
  try {
    if (pathname === '/healthz') return send(res, 200, 'ok');
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
        req.user = currentUser(req);
        if (r.level === 'redirect' && !req.user && !pathname.includes('/callback/')) return redirect(res, '/#/login');
        if (!['public', 'redirect'].includes(r.level)) {
          if (!req.user) bad('Please log in', 401);
          if (r.level === 'admin' && !isOrgAdmin(req.user)) bad('Only workspace admins can do this', 403);
          if (r.level === 'super' && !req.user.is_super) bad('Only the server administrator can do this', 403);
        }
        if (req.method !== 'GET' && req.headers['sec-fetch-site'] === 'cross-site') bad('Cross-site request blocked', 403);
        const out = await r.handler(req, res, params, url.searchParams);
        if (!res.headersSent && out !== undefined) send(res, 200, out);
        return;
      }
      bad('Not found', 404);
    }
    if (pathname.startsWith('/media/')) {
      const f = path.basename(pathname);
      if (!/^[a-f0-9]{32}\.\w+$/.test(f)) return send(res, 404, 'Not found');
      return serveStatic(res, path.join(UPLOAD_DIR, f), 'public, max-age=31536000, immutable');
    }
    if (pathname.startsWith('/bio/')) {
      const html = bioPage(pathname.slice(5).replace(/\/$/, ''));
      return html ? send(res, 200, html, { 'Content-Type': 'text/html; charset=utf-8' }) : send(res, 404, 'Page not found');
    }
    const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveStatic(res, file);
    return serveStatic(res, path.join(PUBLIC_DIR, 'index.html'));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Server error: ' + e.message });
  }
});

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
server.listen(PORT, HOST, () => {
  console.log(`Socialdesk running → http://localhost:${PORT}  (public URL: ${scheduler.publicBase()})`);
  scheduler.start();
});
