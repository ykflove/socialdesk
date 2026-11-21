'use strict';
// End-to-end API tests: boots the real server on a temp data dir.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'socialdesk-test-'));
let proc;

function client() {
  let cookie = '';
  return async (method, url, body, headers = {}) => {
    const init = { method, headers: { ...headers, ...(cookie ? { cookie } : {}) }, redirect: 'manual' };
    if (body instanceof Blob) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
    const r = await fetch(BASE + url, init);
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
}

before(async () => {
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, PUBLIC_URL: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc?.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { } });

const A = client(), B = client();
const ctx = {};

test('first signup becomes server admin', async () => {
  assert.deepStrictEqual((await A('GET', '/api/setup-status')).body, { needsSetup: true, allowSignup: true });
  assert.strictEqual((await A('POST', '/api/signup', { company: 'Acme', name: 'Ann', email: 'ann@acme.test', password: 'password-123' })).status, 200);
  const me = (await A('GET', '/api/me')).body;
  assert.strictEqual(me.is_super, true);
  assert.strictEqual(me.role, 'owner');
  assert.strictEqual(me.org_name, 'Acme');
});

test('second company gets its own workspace', async () => {
  assert.strictEqual((await B('POST', '/api/signup', { company: 'Beta Co', name: 'Bob', email: 'bob@beta.test', password: 'password-456' })).status, 200);
  const me = (await B('GET', '/api/me')).body;
  assert.strictEqual(me.is_super, false);
  assert.strictEqual((await B('GET', '/api/platform')).status, 403);
  ctx.brandA = (await A('GET', '/api/brands')).body[0].id;
  ctx.brandB = (await B('GET', '/api/brands')).body[0].id;
  assert.notStrictEqual(ctx.brandA, ctx.brandB);
});

test('duplicate email and weak password are rejected', async () => {
  assert.strictEqual((await client()('POST', '/api/signup', { name: 'X', email: 'ann@acme.test', password: 'password-123' })).status, 400);
  assert.strictEqual((await client()('POST', '/api/signup', { name: 'X', email: 'x@x.test', password: 'short' })).status, 400);
});

test('connect, upload, publish (reminder network)', async () => {
  const acc = await A('POST', '/api/accounts', { brand_id: ctx.brandA, network: 'reminder', credentials: { profileName: 'acme' } });
  assert.strictEqual(acc.status, 200);
  ctx.accA = acc.body.id;
  const png = new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' });
  const up = await A('POST', `/api/brands/${ctx.brandA}/media`, png, { 'x-filename': 'a.png' });
  assert.strictEqual(up.status, 200);
  ctx.mediaA = up.body.id;
  const post = await A('POST', '/api/posts', { brand_id: ctx.brandA, text: 'Hello', media_ids: [ctx.mediaA], account_ids: [ctx.accA], mode: 'now' });
  assert.strictEqual(post.status, 200);
  ctx.postA = post.body.id;
  let rem = [];
  for (let i = 0; i < 40 && !rem.length; i++) { await new Promise(r => setTimeout(r, 150)); rem = (await A('GET', `/api/brands/${ctx.brandA}/reminders`)).body; }
  assert.strictEqual(rem.length, 1);
  assert.strictEqual(rem[0].text, 'Hello');
  assert.strictEqual((await A('POST', `/api/targets/${rem[0].target_id}/done`, { url: 'https://example.com/p/1' })).status, 200);
  assert.strictEqual((await A('GET', `/api/posts/${ctx.postA}`)).body.status, 'published');
});

test('workspaces cannot see or touch each other', async () => {
  assert.strictEqual((await B('GET', `/api/brands/${ctx.brandA}/accounts`)).status, 404);
  assert.strictEqual((await B('GET', `/api/brands/${ctx.brandA}/posts?status=history`)).status, 404);
  assert.strictEqual((await B('GET', `/api/posts/${ctx.postA}`)).status, 404);
  assert.strictEqual((await B('DELETE', `/api/posts/${ctx.postA}`)).status, 404);
  assert.strictEqual((await B('DELETE', `/api/accounts/${ctx.accA}`)).status, 404);
  assert.strictEqual((await B('PUT', `/api/brands/${ctx.brandA}/bio`, { title: 'hacked' })).status, 404);
  // B cannot post to A's account or attach A's media from its own brand
  const r = await B('POST', '/api/posts', { brand_id: ctx.brandB, text: 'x', media_ids: [ctx.mediaA], account_ids: [ctx.accA], mode: 'schedule', scheduled_at: Date.now() + 1e7 });
  assert.strictEqual(r.status, 400);
  assert.strictEqual((await A('GET', `/api/posts/${ctx.postA}`)).status, 200);
});

test('oauth start without app keys explains what to do', async () => {
  const r = await A('GET', `/api/oauth/start/x?brand=${ctx.brandA}`);
  assert.strictEqual(r.status, 302);
  assert.match(decodeURIComponent(r.headers.get('location')), /not set up on this server/);
});

test('oauth start builds provider URL once keys are saved', async () => {
  assert.strictEqual((await A('PUT', '/api/platform', { integration: { id: 'linkedin', clientId: 'abc', clientSecret: 'def' } })).status, 200);
  const r = await A('GET', `/api/oauth/start/linkedin?brand=${ctx.brandA}`);
  const loc = new URL(r.headers.get('location'));
  assert.strictEqual(loc.host, 'www.linkedin.com');
  assert.strictEqual(loc.searchParams.get('client_id'), 'abc');
  assert.ok(loc.searchParams.get('state'));
  const nets = (await A('GET', '/api/networks')).body;
  assert.strictEqual(nets.find(n => n.id === 'linkedin').oauth.configured, true);
  assert.strictEqual((await B('GET', `/api/oauth/start/linkedin?brand=${ctx.brandA}`)).status, 404);
});

test('oauth callback rejects unknown state', async () => {
  const r = await A('GET', '/api/oauth/callback/linkedin?code=x&state=bogus');
  assert.match(decodeURIComponent(r.headers.get('location')), /expired/);
});

test('closing sign-ups blocks new workspaces', async () => {
  await A('PUT', '/api/platform', { allow_signup: false });
  assert.strictEqual((await client()('POST', '/api/signup', { name: 'C', email: 'c@c.test', password: 'password-789' })).status, 403);
  await A('PUT', '/api/platform', { allow_signup: true });
});

test('link-in-bio page is public', async () => {
  const bio = (await A('GET', `/api/brands/${ctx.brandA}/bio`)).body;
  const r = await client()('GET', `/bio/${bio.slug}`);
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /Acme/);
});
