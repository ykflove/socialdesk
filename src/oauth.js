'use strict';
// One-click "Connect with …" flows. Each provider returns a list of accounts to create.
const crypto = require('node:crypto');
const { db } = require('./db');
const apps = require('./apps');
const { json, request } = require('./networks/util');

const FB = 'v23.0';
const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const form = obj => new URLSearchParams(Object.entries(obj).filter(([, v]) => v != null));
const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');

function need(provider) {
  const a = apps.get(provider);
  if (!a) throw new Error(`${apps.PROVIDERS[provider]?.label || provider} is not set up on this server yet. The administrator must add the app keys in Settings → Integrations.`);
  return a;
}

async function mastodonApp(instance, redirectUri) {
  const row = db.prepare('SELECT * FROM mastodon_apps WHERE instance = ? AND redirect_uri = ?').get(instance, redirectUri);
  if (row) return row;
  const r = await json(`${instance}/api/v1/apps`, { method: 'POST', body: { client_name: 'Socialdesk', redirect_uris: redirectUri, scopes: 'read write' } });
  db.prepare('INSERT OR REPLACE INTO mastodon_apps(instance, redirect_uri, client_id, client_secret) VALUES(?,?,?,?)').run(instance, redirectUri, r.client_id, r.client_secret);
  return { client_id: r.client_id, client_secret: r.client_secret };
}

// Returns { url, data } — data is stored with the state and handed back to callback()
async function start(provider, redirectUri, opts = {}) {
  const state = crypto.randomBytes(24).toString('hex');
  const data = {};
  let url;
  switch (provider) {
    case 'mastodon': {
      let inst = String(opts.instance || '').trim().replace(/\/+$/, '');
      if (!inst) throw new Error('Enter your Mastodon server, e.g. mastodon.social');
      if (!/^https?:\/\//.test(inst)) inst = 'https://' + inst;
      const app = await mastodonApp(inst, redirectUri);
      data.instance = inst;
      url = `${inst}/oauth/authorize?` + form({ client_id: app.client_id, redirect_uri: redirectUri, response_type: 'code', scope: 'read write', state });
      break;
    }
    case 'meta': {
      const a = need('meta');
      url = `https://www.facebook.com/${FB}/dialog/oauth?` + form({
        client_id: a.clientId, redirect_uri: redirectUri, state, response_type: 'code',
        scope: 'pages_show_list,pages_manage_posts,pages_read_engagement,read_insights,business_management,instagram_basic,instagram_content_publish,instagram_manage_insights',
      });
      break;
    }
    case 'threads': {
      const a = need('threads');
      url = 'https://threads.net/oauth/authorize?' + form({ client_id: a.clientId, redirect_uri: redirectUri, scope: 'threads_basic,threads_content_publish,threads_manage_insights', response_type: 'code', state });
      break;
    }
    case 'linkedin': {
      const a = need('linkedin');
      const scope = ['openid', 'profile', 'email', 'w_member_social'];
      if (process.env.LINKEDIN_ORG_SCOPES === '1' || a.orgs) scope.push('w_organization_social', 'r_organization_social', 'rw_organization_admin');
      url = 'https://www.linkedin.com/oauth/v2/authorization?' + form({ response_type: 'code', client_id: a.clientId, redirect_uri: redirectUri, state, scope: scope.join(' ') });
      break;
    }
    case 'x': {
      const a = need('x');
      data.verifier = b64url(crypto.randomBytes(48));
      url = 'https://x.com/i/oauth2/authorize?' + form({
        response_type: 'code', client_id: a.clientId, redirect_uri: redirectUri, state,
        scope: 'tweet.read tweet.write users.read media.write offline.access',
        code_challenge: b64url(crypto.createHash('sha256').update(data.verifier).digest()), code_challenge_method: 'S256',
      });
      break;
    }
    case 'tiktok': {
      const a = need('tiktok');
      url = 'https://www.tiktok.com/v2/auth/authorize/?' + form({ client_key: a.clientId, scope: 'user.info.basic,user.info.stats,video.publish,video.list', response_type: 'code', redirect_uri: redirectUri, state });
      break;
    }
    case 'pinterest': {
      const a = need('pinterest');
      url = 'https://www.pinterest.com/oauth/?' + form({ client_id: a.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'boards:read,pins:read,pins:write,user_accounts:read', state });
      break;
    }
    case 'google': {
      const a = need('google');
      url = 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
        client_id: a.clientId, redirect_uri: redirectUri, response_type: 'code', state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
        scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
      });
      break;
    }
    default: throw new Error('Unknown provider');
  }
  return { state, url, data };
}

async function callback(provider, code, redirectUri, data) {
  switch (provider) {
    case 'mastodon': {
      const app = await mastodonApp(data.instance, redirectUri);
      const t = await json(`${data.instance}/oauth/token`, { method: 'POST', body: form({ grant_type: 'authorization_code', code, client_id: app.client_id, client_secret: app.client_secret, redirect_uri: redirectUri, scope: 'read write' }) });
      const me = await json(`${data.instance}/api/v1/accounts/verify_credentials`, { headers: { Authorization: `Bearer ${t.access_token}` } });
      return [{ network: 'mastodon', remoteKey: `${data.instance}#${me.id}`, name: me.display_name || me.username, handle: '@' + me.acct + '@' + new URL(data.instance).host, avatar: me.avatar, creds: { instance: data.instance, token: t.access_token, accountId: me.id } }];
    }
    case 'meta': {
      const a = need('meta');
      const short = await json(`https://graph.facebook.com/${FB}/oauth/access_token?` + form({ client_id: a.clientId, client_secret: a.clientSecret, redirect_uri: redirectUri, code }));
      const long = await json(`https://graph.facebook.com/${FB}/oauth/access_token?` + form({ grant_type: 'fb_exchange_token', client_id: a.clientId, client_secret: a.clientSecret, fb_exchange_token: short.access_token }));
      const out = [];
      let next = `https://graph.facebook.com/${FB}/me/accounts?` + form({ fields: 'id,name,username,access_token,picture{url},instagram_business_account{id,username,name,profile_picture_url}', limit: 100, access_token: long.access_token });
      while (next) {
        const r = await json(next);
        for (const p of r.data || []) {
          out.push({ network: 'facebook', remoteKey: p.id, name: p.name, handle: p.username ? '@' + p.username : p.id, avatar: p.picture?.data?.url || null, creds: { pageId: p.id, token: p.access_token } });
          const ig = p.instagram_business_account;
          if (ig) out.push({ network: 'instagram', remoteKey: ig.id, name: ig.name || ig.username, handle: '@' + ig.username, avatar: ig.profile_picture_url || null, creds: { igUserId: ig.id, token: p.access_token } });
        }
        next = r.paging?.next || null;
      }
      if (!out.length) throw new Error('No Facebook Pages were shared. Make sure you select your Pages (and their linked Instagram accounts) in the Facebook dialog.');
      return out;
    }
    case 'threads': {
      const a = need('threads');
      const short = await json('https://graph.threads.net/oauth/access_token', { method: 'POST', body: form({ client_id: a.clientId, client_secret: a.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }) });
      const long = await json('https://graph.threads.net/access_token?' + form({ grant_type: 'th_exchange_token', client_secret: a.clientSecret, access_token: short.access_token }));
      const me = await json('https://graph.threads.net/v1.0/me?' + form({ fields: 'id,username,name,threads_profile_picture_url', access_token: long.access_token }));
      return [{ network: 'threads', remoteKey: me.id, name: me.name || me.username, handle: '@' + me.username, avatar: me.threads_profile_picture_url || null, creds: { userId: me.id, token: long.access_token, expiresAt: Date.now() + (long.expires_in || 5184000) * 1000 } }];
    }
    case 'linkedin': {
      const a = need('linkedin');
      const t = await json('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: a.clientId, client_secret: a.clientSecret }) });
      const base = { token: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 5184000) * 1000 };
      const me = await json('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
      const out = [{ network: 'linkedin', remoteKey: 'person:' + me.sub, name: me.name, handle: me.email || 'LinkedIn member', avatar: me.picture || null, creds: { ...base, author: `urn:li:person:${me.sub}` } }];
      try { // company pages the user administers (needs Community Management API)
        const H = { Authorization: `Bearer ${t.access_token}`, 'LinkedIn-Version': '202604', 'X-Restli-Protocol-Version': '2.0.0' };
        const acl = await json('https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED', { headers: H });
        for (const e of acl.elements || []) {
          const id = e.organization.split(':').pop();
          let o = {}; try { o = await json(`https://api.linkedin.com/rest/organizations/${id}`, { headers: H }); } catch { }
          out.push({ network: 'linkedin', remoteKey: 'org:' + id, name: o.localizedName || `Company ${id}`, handle: o.vanityName ? '/company/' + o.vanityName : e.organization, avatar: null, creds: { ...base, author: e.organization } });
        }
      } catch { /* scope not granted — personal profile only */ }
      return out;
    }
    case 'x': {
      const a = need('x');
      const t = await json('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { Authorization: basic(a.clientId, a.clientSecret) }, body: form({ code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: data.verifier, client_id: a.clientId }) });
      const me = await json('https://api.x.com/2/users/me?user.fields=profile_image_url', { headers: { Authorization: `Bearer ${t.access_token}` } });
      return [{ network: 'x', remoteKey: me.data.id, name: me.data.name, handle: '@' + me.data.username, avatar: me.data.profile_image_url || null, creds: { oauth2: true, accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 7200) * 1000, username: me.data.username } }];
    }
    case 'tiktok': {
      const a = need('tiktok');
      const t = await json('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', body: form({ client_key: a.clientId, client_secret: a.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
      if (!t.access_token) throw new Error('TikTok: ' + (t.error_description || t.error || 'no token returned'));
      const u = (await json('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url,username', { headers: { Authorization: `Bearer ${t.access_token}` } })).data.user;
      return [{ network: 'tiktok', remoteKey: t.open_id || u.open_id, name: u.display_name, handle: u.username ? '@' + u.username : u.open_id, avatar: u.avatar_url || null, creds: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 86400) * 1000, privacy: 'SELF_ONLY' } }];
    }
    case 'pinterest': {
      const a = need('pinterest');
      const t = await json('https://api.pinterest.com/v5/oauth/token', { method: 'POST', headers: { Authorization: basic(a.clientId, a.clientSecret) }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }) });
      const H = { Authorization: `Bearer ${t.access_token}` };
      const me = await json('https://api.pinterest.com/v5/user_account', { headers: H });
      const boards = (await json('https://api.pinterest.com/v5/boards?page_size=100', { headers: H })).items || [];
      const creds = { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 2592000) * 1000 };
      if (!boards.length) throw new Error('Create at least one Pinterest board first, then connect again.');
      return boards.map(b => ({ network: 'pinterest', remoteKey: 'board:' + b.id, name: `${me.username} · ${b.name}`, handle: '@' + me.username, avatar: me.profile_image || null, creds: { ...creds, boardId: b.id } }));
    }
    case 'google': {
      const a = need('google');
      const t = await json('https://oauth2.googleapis.com/token', { method: 'POST', body: form({ code, client_id: a.clientId, client_secret: a.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
      const ch = await json('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${t.access_token}` } });
      if (!ch.items?.length) throw new Error('This Google account has no YouTube channel.');
      return ch.items.map(c => ({ network: 'youtube', remoteKey: c.id, name: c.snippet.title, handle: c.snippet.customUrl || c.id, avatar: c.snippet.thumbnails?.default?.url || null, creds: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000, channelId: c.id, privacy: 'public' } }));
    }
  }
  throw new Error('Unknown provider');
}

// ---- token refresh helpers used by network adapters ----
async function refreshX(c) {
  const a = need('x');
  const t = await json('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { Authorization: basic(a.clientId, a.clientSecret) }, body: form({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: a.clientId }) });
  Object.assign(c, { accessToken: t.access_token, refreshToken: t.refresh_token || c.refreshToken, expiresAt: Date.now() + (t.expires_in || 7200) * 1000 });
}
async function refreshGoogle(c) {
  const a = need('google');
  const t = await json('https://oauth2.googleapis.com/token', { method: 'POST', body: form({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: a.clientId, client_secret: a.clientSecret }) });
  Object.assign(c, { accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000 });
}
async function refreshPinterest(c) {
  const a = need('pinterest');
  const t = await json('https://api.pinterest.com/v5/oauth/token', { method: 'POST', headers: { Authorization: basic(a.clientId, a.clientSecret) }, body: form({ grant_type: 'refresh_token', refresh_token: c.refreshToken }) });
  Object.assign(c, { accessToken: t.access_token, refreshToken: t.refresh_token || c.refreshToken, expiresAt: Date.now() + (t.expires_in || 2592000) * 1000 });
}
async function refreshThreads(c) {
  const t = await json('https://graph.threads.net/refresh_access_token?' + form({ grant_type: 'th_refresh_token', access_token: c.token }));
  Object.assign(c, { token: t.access_token, expiresAt: Date.now() + (t.expires_in || 5184000) * 1000 });
}
async function refreshTikTok(c) {
  const a = apps.get('tiktok');
  const key = c.clientKey || a?.clientId, secret = c.clientSecret || a?.clientSecret;
  if (!key || !secret || !c.refreshToken) return;
  const t = await json('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', body: form({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: c.refreshToken }) });
  if (t.access_token) Object.assign(c, { accessToken: t.access_token, refreshToken: t.refresh_token || c.refreshToken, expiresAt: Date.now() + (t.expires_in || 86400) * 1000 });
}
const soon = c => c.expiresAt && Date.now() > c.expiresAt - 5 * 60_000;

module.exports = { start, callback, refreshX, refreshGoogle, refreshPinterest, refreshThreads, refreshTikTok, soon, request };
