'use strict';
const path = require('node:path');
const { db, UPLOAD_DIR, encrypt, decrypt, getSetting } = require('./db');
const { networks } = require('./networks');

const MAX_ATTEMPTS = 3;
let running = false;

function log(...a) { console.log(new Date().toISOString(), '[scheduler]', ...a); }

function loadAccount(id) {
  const a = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!a) return null;
  a.creds = decrypt(a.credentials);
  a.credsBefore = JSON.stringify(a.creds);
  return a;
}
function saveCredsIfChanged(a) {
  if (JSON.stringify(a.creds) !== a.credsBefore) {
    db.prepare('UPDATE accounts SET credentials = ? WHERE id = ?').run(encrypt(a.creds), a.id);
    a.credsBefore = JSON.stringify(a.creds);
  }
}

function publicBase() {
  return (process.env.PUBLIC_URL || getSetting('public_url') || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
}

function mediaFor(post) {
  const ids = JSON.parse(post.media_ids || '[]');
  if (!ids.length) return [];
  const rows = db.prepare(`SELECT * FROM media WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  return ids.map(id => byId[id]).filter(Boolean).map(m => ({
    ...m, path: path.join(UPLOAD_DIR, m.filename), url: `${publicBase()}/media/${m.filename}`,
  }));
}

function refreshPostStatus(postId) {
  const ts = db.prepare('SELECT status FROM post_targets WHERE post_id = ?').all(postId).map(t => t.status);
  const post = db.prepare('SELECT status FROM posts WHERE id = ?').get(postId);
  if (!post || post.status === 'draft') return;
  let s;
  if (!ts.length) s = 'failed';
  else if (ts.some(x => x === 'pending')) s = ts.some(x => x !== 'pending') ? 'publishing' : post.status === 'publishing' ? 'publishing' : 'scheduled';
  else if (ts.every(x => x === 'published' || x === 'manual')) s = 'published';
  else if (ts.every(x => x === 'failed')) s = 'failed';
  else s = 'partial';
  db.prepare('UPDATE posts SET status = ?, updated_at = ? WHERE id = ?').run(s, Date.now(), postId);
}

async function publishTarget(t) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(t.post_id);
  const acc = loadAccount(t.account_id);
  const net = acc && networks[acc.network];
  const upd = db.prepare('UPDATE post_targets SET status=?, remote_id=?, remote_url=?, error=?, attempts=?, retry_at=?, published_at=? WHERE id=?');
  if (!net) { upd.run('failed', null, null, 'Account or network missing', t.attempts + 1, null, null, t.id); return; }
  const overrides = JSON.parse(post.overrides || '{}');
  const text = (overrides[acc.id] ?? post.text) || '';
  try {
    log(`publishing post ${post.id} → ${acc.network}:${acc.name}`);
    const r = await net.publish(acc.creds, { text, media: mediaFor(post) });
    saveCredsIfChanged(acc);
    if (r.manual) upd.run('manual', null, null, null, t.attempts + 1, null, Date.now(), t.id);
    else upd.run('published', r.remoteId || null, r.url || null, null, t.attempts + 1, null, Date.now(), t.id);
    db.prepare("UPDATE accounts SET status='ok', last_error=NULL WHERE id=?").run(acc.id);
  } catch (e) {
    saveCredsIfChanged(acc);
    const attempts = t.attempts + 1;
    const permanent = e.status && e.status >= 400 && e.status < 500 && e.status !== 429;
    const giveUp = attempts >= MAX_ATTEMPTS || permanent;
    log(`failed post ${post.id} → ${acc.network}: ${e.message}${giveUp ? '' : ' (will retry)'}`);
    upd.run(giveUp ? 'failed' : 'pending', null, null, e.message, attempts, giveUp ? null : Date.now() + attempts * 2 * 60_000, null, t.id);
    if (e.status === 401 || e.status === 403) db.prepare("UPDATE accounts SET status='error', last_error=? WHERE id=?").run(e.message, acc.id);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const due = db.prepare(`
      SELECT t.* FROM post_targets t JOIN posts p ON p.id = t.post_id
      WHERE t.status = 'pending' AND p.status IN ('scheduled','publishing','partial')
        AND p.scheduled_at <= ? AND (t.retry_at IS NULL OR t.retry_at <= ?)
      ORDER BY p.scheduled_at LIMIT 20`).all(now, now);
    const postIds = new Set(due.map(t => t.post_id));
    for (const id of postIds) db.prepare("UPDATE posts SET status='publishing' WHERE id=?").run(id);
    for (const t of due) await publishTarget(t);
    for (const id of postIds) refreshPostStatus(id);
  } catch (e) { log('tick error', e); }
  finally { running = false; }
}

// ---------------- analytics ----------------
let collecting = false;
async function collectAnalytics(onlyAccountId) {
  if (collecting) return;
  collecting = true;
  const day = new Date().toISOString().slice(0, 10);
  try {
    const accs = onlyAccountId ? [{ id: onlyAccountId }] : db.prepare('SELECT id FROM accounts').all();
    for (const { id } of accs) {
      const a = loadAccount(id);
      const net = a && networks[a.network];
      if (!net) continue;
      if (net.stats) {
        try {
          const s = await net.stats(a.creds);
          if (s) db.prepare(`INSERT INTO account_stats(account_id, day, followers, following, posts_count) VALUES(?,?,?,?,?)
            ON CONFLICT(account_id, day) DO UPDATE SET followers=excluded.followers, following=excluded.following, posts_count=excluded.posts_count`)
            .run(a.id, day, s.followers ?? null, s.following ?? null, s.posts ?? null);
        } catch (e) { log(`stats ${a.network}:${a.name}: ${e.message}`); }
      }
      if (net.metrics) {
        const targets = db.prepare(`SELECT id, remote_id FROM post_targets WHERE account_id=? AND status='published'
          AND remote_id IS NOT NULL AND published_at > ?`).all(a.id, Date.now() - 60 * 86400_000);
        for (const t of targets) {
          try {
            const m = await net.metrics(a.creds, t.remote_id);
            if (m) db.prepare('UPDATE post_targets SET likes=?, comments=?, shares=?, views=?, metrics_at=? WHERE id=?')
              .run(m.likes ?? null, m.comments ?? null, m.shares ?? null, m.views ?? null, Date.now(), t.id);
          } catch (e) { log(`metrics ${a.network} ${t.remote_id}: ${e.message}`); }
        }
      }
      saveCredsIfChanged(a);
    }
  } finally { collecting = false; }
}

function start() {
  setInterval(tick, 20_000);
  setTimeout(tick, 2000);
  setInterval(() => collectAnalytics().catch(e => log(e)), 3 * 3600_000);
  setTimeout(() => collectAnalytics().catch(e => log(e)), 15_000);
}

module.exports = { start, tick, collectAnalytics, refreshPostStatus, loadAccount, saveCredsIfChanged, publicBase };
