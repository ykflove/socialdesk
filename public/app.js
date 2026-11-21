'use strict';
/* Socialdesk front-end — vanilla JS single page app */

// ---------------- utilities ----------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = n => n == null ? '—' : Intl.NumberFormat(undefined, { notation: Math.abs(n) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
const fmtDT = ms => ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const fmtT = ms => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const DAY = 86400000;
const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const toLocalInput = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const graphemes = s => { try { return [...new Intl.Segmenter().segment(s)].length; } catch { return [...s].length; } };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } } };

function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), err ? 7000 : 3500);
}

async function api(method, url, body, opts = {}) {
  const init = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof Blob) { init.body = body; init.headers['Content-Type'] = body.type; Object.assign(init.headers, opts.headers || {}); }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, init);
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !url.includes('/login')) { state.me = null; render(); throw new Error('Please log in'); }
  if (!r.ok) throw new Error(data?.error || data || r.statusText);
  return data;
}
const tryApi = async (...a) => { try { return await api(...a); } catch (e) { toast(e.message, true); throw e; } };

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5.5"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  left: '<path d="M15 18l-6-6 6-6"/>', right: '<path d="M9 18l6-6-6-6"/>',
  ext: '<path d="M14 3h7v7M10 14L21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
};
const icon = (n, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;
const NET_TAG = { bluesky: 'B', mastodon: 'M', telegram: 'T', discord: 'D', facebook: 'f', instagram: 'IG', linkedin: 'in', x: '𝕏', tiktok: 'TT', snapchat: 'S', reminder: '⏰', threads: '@', youtube: '▶', pinterest: 'P' };
function netBadge(id, sm) {
  const n = state.networks.find(x => x.id === id) || { color: '#888' };
  const fg = id === 'snapchat' ? '#111' : '#fff';
  return `<span class="net${sm ? ' sm' : ''}" style="background:${n.color};color:${fg}" title="${esc(n.label)}">${NET_TAG[id] || '?'}</span>`;
}
function accAvatar(a, size = 36) {
  const img = a.avatar ? `<img class="avatar" src="${esc(a.avatar)}" alt="" style="width:${size}px;height:${size}px" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'avatar',style:'width:${size}px;height:${size}px'}))">` : `<span class="avatar" style="width:${size}px;height:${size}px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;color:var(--muted)">${esc((a.name || '?')[0].toUpperCase())}</span>`;
  return `<span style="position:relative;display:inline-flex">${img}<span style="position:absolute;right:-4px;bottom:-4px">${netBadge(a.network, true)}</span></span>`;
}
const statusPill = s => ({
  draft: '<span class="pill">Draft</span>', scheduled: '<span class="pill acc">Scheduled</span>', publishing: '<span class="pill warn pubbing">Publishing…</span>',
  published: '<span class="pill ok">Published</span>', partial: '<span class="pill warn">Partly published</span>', failed: '<span class="pill bad">Failed</span>',
  pending: '<span class="pill acc">Pending</span>', manual: '<span class="pill warn">Post manually</span>',
}[s] || `<span class="pill">${esc(s)}</span>`);
const mediaTag = (m, attrs = '') => m.mime.startsWith('video/') ? `<video src="/media/${m.filename}" muted preload="metadata" ${attrs}></video>` : `<img src="/media/${m.filename}" alt="" loading="lazy" ${attrs}>`;

// ---------------- state ----------------
const state = { me: undefined, brands: [], brandId: store.get('brand', null), networks: [], accounts: [], reminders: 0, settings: {} };
const brand = () => state.brands.find(b => b.id === state.brandId);

async function loadBase() {
  [state.brands, state.networks] = await Promise.all([api('GET', '/api/brands'), api('GET', '/api/networks')]);
  if (!state.brands.find(b => b.id === state.brandId)) state.brandId = state.brands[0]?.id;
  store.set('brand', state.brandId);
  await loadBrand();
}
async function loadBrand() {
  [state.accounts, state.remindersList] = await Promise.all([
    api('GET', `/api/brands/${state.brandId}/accounts`), api('GET', `/api/brands/${state.brandId}/reminders`)]);
  state.reminders = state.remindersList.length;
}

// ---------------- shell ----------------
const NAV = [['/', 'home', 'Dashboard'], ['/planner', 'cal', 'Planner'], ['/analytics', 'chart', 'Analytics'], ['/accounts', 'users', 'Accounts'],
  ['/bio', 'link', 'Link in bio'], ['/reminders', 'bell', 'Reminders'], ['/settings', 'gear', 'Settings']];
const route = () => (location.hash.slice(1) || '/').split('?')[0];

async function render() {
  const root = $('#root');
  if (state.me === undefined) {
    try { state.me = await api('GET', '/api/me'); } catch { state.me = null; }
  }
  if (!state.me) return renderAuth(root);
  if (!state.brands.length) await loadBase();
  const r = route();
  root.innerHTML = `
  <div class="mobile-bar"><button class="icon-btn" id="menuBtn">${icon('menu', 22)}</button><b>Socialdesk</b></div>
  <div class="app">
    <aside class="side" id="side">
      <div class="logo"><i></i>Socialdesk</div>
      <div class="brand-pick"><select id="brandSel">${state.brands.map(b => `<option value="${b.id}" ${b.id === state.brandId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="new">+ New brand…</option></select></div>
      <nav class="nav">${NAV.concat(state.me.is_super ? [['/server', 'gear', 'Server admin']] : []).map(([p, i, l]) => `<a href="#${p}" class="${r === p ? 'on' : ''}">${icon(i)}${l}${p === '/reminders' && state.reminders ? `<span class="badge">${state.reminders}</span>` : ''}</a>`).join('')}</nav>
      <div class="foot"><span title="${esc(state.me.org_name)}">${esc(state.me.name)}<br><span class="small">${esc(state.me.org_name)}</span></span><button class="btn sm" id="logout">Log out</button></div>
    </aside>
    <main class="view" id="view"></main>
  </div>`;
  $('#menuBtn').onclick = () => $('#side').classList.toggle('open');
  $('#logout').onclick = async () => { await api('POST', '/api/logout'); state.me = null; state.brands = []; render(); };
  $('#brandSel').onchange = async e => {
    if (e.target.value === 'new') {
      const name = prompt('Brand name');
      if (!name) { e.target.value = state.brandId; return; }
      const { id } = await tryApi('POST', '/api/brands', { name });
      state.brands = await api('GET', '/api/brands'); state.brandId = id;
    } else state.brandId = Number(e.target.value);
    store.set('brand', state.brandId);
    await loadBrand(); render();
  };
  const v = $('#view');
  const views = { '/': viewDashboard, '/planner': viewPlanner, '/analytics': viewAnalytics, '/accounts': viewAccounts, '/bio': viewBio, '/reminders': viewReminders, '/settings': viewSettings, '/server': viewServer };
  try { await (views[r] || viewDashboard)(v); } catch (e) { v.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', render);

async function renderAuth(root) {
  const { needsSetup, allowSignup } = await api('GET', '/api/setup-status');
  if (!state.networks.length) { try { state.networks = await api('GET', '/api/networks'); } catch { } }
  const r = route();
  if (r !== '/login' && r !== '/signup' && !needsSetup) return renderLanding(root, allowSignup);
  const signup = needsSetup || (r === '/signup' && allowSignup);
  root.innerHTML = `<div class="auth"><form class="card" id="authForm">
    <a class="logo" href="#/" style="padding:0 0 18px;text-decoration:none;color:inherit"><i></i>Socialdesk</a>
    <h2>${needsSetup ? 'Set up your server' : signup ? 'Create your free workspace' : 'Log in'}</h2>
    ${needsSetup ? '<p class="muted small" style="margin-top:-6px">First run — this account becomes the server administrator.</p>' : ''}
    ${signup ? `<label class="f"><span>Company or project</span><input type="text" name="company" placeholder="Acme Inc." autocomplete="organization"></label>
      <label class="f"><span>Your name</span><input type="text" name="name" required autocomplete="name"></label>` : ''}
    <label class="f"><span>Email</span><input type="email" name="email" required autocomplete="username"></label>
    <label class="f"><span>Password</span><input type="password" name="password" required minlength="${signup ? 8 : 1}" autocomplete="${signup ? 'new-password' : 'current-password'}">${signup ? '<small>At least 8 characters</small>' : ''}</label>
    <button class="btn primary" style="width:100%;justify-content:center">${signup ? 'Create workspace' : 'Log in'}</button>
    ${needsSetup ? '' : `<p class="small muted" style="text-align:center;margin:14px 0 0">${signup ? 'Already have an account? <a href="#/login">Log in</a>' : allowSignup ? 'New here? <a href="#/signup">Create a free workspace</a>' : 'Ask your administrator for an account.'}</p>`}
  </form></div>`;
  $('#authForm').onsubmit = async e => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      await api('POST', signup ? '/api/signup' : '/api/login', body);
      state.me = undefined; state.brands = [];
      location.hash = signup ? '#/accounts' : '#/';
      render();
    } catch (err) { toast(err.message, true); }
  };
}

function renderLanding(root, allowSignup) {
  const nets = state.networks.length ? state.networks : [];
  const F = [
    ['cal', 'Plan everything in one calendar', 'Month, week and list views. Drag posts to reschedule. Drafts, queue and history for every brand.'],
    ['plus', 'Post everywhere at once', 'Write once, pick your accounts, tweak the text per network and publish now or at the perfect time.'],
    ['users', 'One-click account login', 'Connect Facebook, Instagram, Threads, X, LinkedIn, TikTok, YouTube, Pinterest, Mastodon and more with their own login buttons.'],
    ['chart', 'Analytics that matter', 'Follower growth, engagement per post and network, best time to post, CSV export and printable reports.'],
    ['link', 'Link in bio', 'A fast landing page for your profiles with your links and latest posts. Free, no extra tool.'],
    ['gear', 'Yours, forever free', 'Open source (MIT). Host it yourself, unlimited brands, users and posts. Your data never leaves your server.'],
  ];
  root.innerHTML = `<div class="landing">
    <header class="lnav"><div class="logo" style="padding:0"><i></i>Socialdesk</div><div class="row"><a class="btn" href="#/login">Log in</a>${allowSignup ? '<a class="btn primary" href="#/signup">Start free</a>' : ''}</div></header>
    <section class="hero">
      <span class="pill acc">100% free · open source · self-hosted</span>
      <h1>Plan, publish and measure all your social media in one place</h1>
      <p class="muted">Socialdesk is a social media scheduler for companies, agencies and creators. Connect every profile once, schedule posts to all of them at once, and track what works.</p>
      <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap">${allowSignup ? '<a class="btn primary lg" href="#/signup">Create your free workspace</a>' : ''}<a class="btn lg" href="#/login">Log in</a></div>
      <div class="netrow">${nets.map(n => netBadge(n.id)).join('')}</div>
    </section>
    <section class="feat">${F.map(([i, t, d]) => `<div class="card"><div class="ficon">${icon(i, 22)}</div><h3>${t}</h3><p class="muted">${d}</p></div>`).join('')}</section>
    <section class="cta card"><h2>No subscriptions. No seat limits. No catch.</h2><p class="muted">Every feature is free for everyone. Run it on your own computer or a free cloud server and invite your whole team and your clients.</p>${allowSignup ? '<a class="btn primary lg" href="#/signup">Get started</a>' : ''}</section>
    <footer class="lfoot muted small">Socialdesk — free &amp; open-source social media management · MIT License</footer>
  </div>`;
}

// ---------------- modal ----------------
function modal({ title, body, footer = '', wide }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><header><h2 style="margin:0">${title}</h2><button class="icon-btn" data-close>${icon('x', 20)}</button></header><div class="body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
  $('[data-close]', bg).onclick = close;
  document.body.append(bg);
  return { el: bg, close };
}

// ---------------- charts ----------------
function lineChart(series, { height = 220, fmtX = x => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } = {}) {
  const W = 760, H = height, P = { l: 48, r: 12, t: 12, b: 26 };
  const pts = series.flatMap(s => s.points);
  if (pts.length < 1) return '<div class="empty">Not enough data yet — stats are collected every few hours.</div>';
  let [x0, x1] = [Math.min(...pts.map(p => p[0])), Math.max(...pts.map(p => p[0]))];
  let [y0, y1] = [Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[1]))];
  if (x0 === x1) { x0 -= DAY; x1 += DAY; }
  const pad = (y1 - y0) * 0.1 || Math.max(1, y1 * 0.05); y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = x => P.l + (x - x0) / (x1 - x0) * (W - P.l - P.r), Y = y => H - P.b - (y - y0) / (y1 - y0) * (H - P.t - P.b);
  const ticks = [0, .25, .5, .75, 1].map(f => y0 + f * (y1 - y0));
  const xt = [0, .5, 1].map(f => x0 + f * (x1 - x0));
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">
    ${ticks.map(t => `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" stroke-dasharray="${t === y0 ? '' : '3 4'}"/><text x="${P.l - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtN(Math.round(t))}</text>`).join('')}
    ${xt.map((t, i) => `<text x="${X(t)}" y="${H - 6}" text-anchor="${['start', 'middle', 'end'][i]}">${fmtX(t)}</text>`).join('')}
    ${series.map(s => s.points.length ? `<path d="${s.points.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>
      ${s.points.map(p => `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${s.points.length > 40 ? 0 : 3}" fill="${s.color}" data-tip="${esc(s.name)}: ${fmtN(p[1])} · ${fmtX(p[0])}"><title>${esc(s.name)}: ${p[1]}</title></circle>`).join('')}` : '').join('')}
  </svg></div>${series.length > 1 ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>` : ''}`;
}
function barChart(items, { height = 200 } = {}) {
  if (!items.length) return '<div class="empty">No data yet.</div>';
  const W = 760, H = height, P = { l: 40, r: 8, t: 10, b: 28 };
  const max = Math.max(1, ...items.map(i => i.value));
  const bw = (W - P.l - P.r) / items.length;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}">
    <line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>
    <text x="${P.l - 6}" y="${P.t + 8}" text-anchor="end">${fmtN(max)}</text>
    ${items.map((it, i) => { const h = it.value / max * (H - P.t - P.b); const x = P.l + i * bw + bw * .18;
      return `<rect x="${x}" y="${H - P.b - h}" width="${bw * .64}" height="${h}" rx="4" fill="${it.color}"><title>${esc(it.label)}: ${it.value}</title></rect>
      <text x="${x + bw * .32}" y="${H - 9}" text-anchor="middle">${esc(it.label.length > 12 ? it.label.slice(0, 11) + '…' : it.label)}</text>`; }).join('')}
  </svg></div>`;
}

// ---------------- dashboard ----------------
async function viewDashboard(v) {
  const [a, queue] = await Promise.all([api('GET', `/api/brands/${state.brandId}/analytics?days=30`), api('GET', `/api/brands/${state.brandId}/posts?status=queue`)]);
  const t = a.totals;
  postCache = Object.fromEntries(queue.map(p => [p.id, p]));
  const eng = t.likes + t.comments + t.shares;
  const errAccs = state.accounts.filter(x => x.status === 'error');
  v.innerHTML = `
  <div class="head"><div><h1>Hello, ${esc(state.me.name.split(' ')[0])}</h1><div class="muted">${esc(brand()?.name)} · last 30 days</div></div>
    <div class="actions"><button class="btn primary" id="newPost">${icon('plus', 16)}Create post</button></div></div>
  ${!state.accounts.length ? `<div class="card" style="margin-bottom:16px"><h2>Get started</h2><p class="muted" style="margin-top:0">Connect your first social account to start scheduling.</p><a class="btn primary" href="#/accounts">Connect an account</a></div>` : ''}
  ${errAccs.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--bad)"><b class="down">${errAccs.length} account(s) need attention:</b> ${errAccs.map(x => esc(x.name)).join(', ')} — <a href="#/accounts">reconnect</a></div>` : ''}
  ${state.reminders ? `<div class="card" style="margin-bottom:16px;border-color:var(--warn)"><b>${state.reminders} post(s) are ready for you to publish manually.</b> <a href="#/reminders">Open reminders</a></div>` : ''}
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="muted">Audience</div><div class="v">${fmtN(t.followers)}</div><div class="d ${t.followerChange >= 0 ? 'up' : 'down'}">${t.followerChange >= 0 ? '+' : ''}${fmtN(t.followerChange)} this period</div></div>
    <div class="card kpi"><div class="muted">Posts published</div><div class="v">${fmtN(t.posts)}</div><div class="d muted">${t.scheduled} scheduled</div></div>
    <div class="card kpi"><div class="muted">Engagement</div><div class="v">${fmtN(eng)}</div><div class="d muted">${fmtN(t.likes)} likes · ${fmtN(t.comments)} comments</div></div>
    <div class="card kpi"><div class="muted">Avg. per post</div><div class="v">${t.posts ? fmtN(Math.round(eng / t.posts * 10) / 10) : '—'}</div><div class="d muted">interactions</div></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="row between"><h2>Up next</h2><a href="#/planner" class="small">Open planner</a></div>
      <div class="list">${queue.slice(0, 6).map(p => postRow(p)).join('') || '<div class="empty">Nothing scheduled. <a href="#" data-new>Plan a post</a></div>'}</div></div>
    <div class="card"><div class="row between"><h2>Audience growth</h2><a href="#/analytics" class="small">Analytics</a></div>
      ${lineChart(a.accounts.filter(x => x.series.length).map(x => ({ name: x.name, color: x.color === '#000000' || x.color === '#111111' ? 'var(--text)' : x.color, points: x.series.filter(s => s.followers != null).map(s => [new Date(s.day).getTime(), s.followers]) })))}
    </div>
  </div>`;
  $('#newPost').onclick = () => openComposer({});
  $$('[data-new]', v).forEach(b => b.onclick = e => { e.preventDefault(); openComposer({}); });
  bindPostRows(v);
}
function postRow(p) {
  const nets = [...new Set(p.targets.map(t => t.network))];
  return `<div class="row" style="padding:10px 0;cursor:pointer" data-post="${p.id}">
    ${p.media[0] ? mediaTag(p.media[0], 'class="thumb"') : `<div class="thumb"></div>`}
    <div style="flex:1;min-width:0"><div class="clip">${esc(p.text) || '<span class="muted">(media only)</span>'}</div>
    <div class="row small muted" style="gap:6px;margin-top:3px">${nets.map(n => netBadge(n, true)).join('')} ${p.scheduled_at ? fmtDT(p.scheduled_at) : 'No date'}</div></div>
    ${statusPill(p.status)}</div>`;
}
let postCache = {};
function bindPostRows(el) {
  $$('[data-post]', el).forEach(r => r.onclick = async e => {
    e.stopPropagation();
    const id = Number(r.dataset.post);
    const p = postCache[id] || (await api('GET', `/api/brands/${state.brandId}/posts?status=history`)).concat(await api('GET', `/api/brands/${state.brandId}/posts?status=queue`), await api('GET', `/api/brands/${state.brandId}/posts?status=draft`)).find(x => x.id === id);
    if (p) openComposer({ post: p });
  });
}

// ---------------- planner ----------------
const plan = { mode: store.get('planMode', 'month'), cursor: Date.now(), list: 'queue' };
async function viewPlanner(v) {
  const c = new Date(plan.cursor);
  let from, to, title;
  if (plan.mode === 'month') {
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    from = startOfDay(first.getTime() - ((first.getDay() + 6) % 7) * DAY).getTime();
    to = from + 42 * DAY;
    title = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } else if (plan.mode === 'week') {
    from = startOfDay(c.getTime() - ((c.getDay() + 6) % 7) * DAY).getTime();
    to = from + 7 * DAY;
    title = `${new Date(from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(to - 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  const posts = plan.mode === 'list' ? await api('GET', `/api/brands/${state.brandId}/posts?status=${plan.list}`) : await api('GET', `/api/brands/${state.brandId}/posts?from=${from}&to=${to}`);
  postCache = Object.fromEntries(posts.map(p => [p.id, p]));
  v.innerHTML = `
  <div class="head"><div class="row" style="gap:14px"><h1>Planner</h1>
    ${plan.mode !== 'list' ? `<div class="row" style="gap:4px"><button class="icon-btn" id="prev">${icon('left')}</button><button class="btn sm" id="today">Today</button><button class="icon-btn" id="next">${icon('right')}</button></div><b>${title}</b>` : ''}</div>
    <div class="actions"><div class="tabs" id="modeTabs">${['month', 'week', 'list'].map(m => `<button data-m="${m}" class="${plan.mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>
    <button class="btn primary" id="newPost">${icon('plus', 16)}Create post</button></div></div>
  <div id="planBody"></div>`;
  const body = $('#planBody');
  if (plan.mode === 'month') body.innerHTML = monthGrid(from, c.getMonth(), posts);
  else if (plan.mode === 'week') body.innerHTML = weekGrid(from, posts);
  else body.innerHTML = `<div class="tabs" style="margin-bottom:12px">${[['queue', 'Queue'], ['draft', 'Drafts'], ['history', 'Published & failed']].map(([k, l]) => `<button data-l="${k}" class="${plan.list === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="card"><div class="list">${posts.map(postRow).join('') || '<div class="empty">Nothing here.</div>'}</div></div>`;
  $$('[data-l]', body).forEach(b => b.onclick = () => { plan.list = b.dataset.l; viewPlanner(v); });
  $('#newPost').onclick = () => openComposer({});
  $$('#modeTabs button').forEach(b => b.onclick = () => { plan.mode = b.dataset.m; store.set('planMode', plan.mode); viewPlanner(v); });
  const step = d => { const x = new Date(plan.cursor); if (plan.mode === 'month') x.setMonth(x.getMonth() + d, 1); else x.setDate(x.getDate() + 7 * d); plan.cursor = x.getTime(); viewPlanner(v); };
  if ($('#prev')) { $('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1); $('#today').onclick = () => { plan.cursor = Date.now(); viewPlanner(v); }; }
  bindPostRows(body);
  // click empty slot → compose; drag chips → move
  $$('[data-slot]', body).forEach(cell => {
    cell.onclick = e => { if (e.target.closest('[data-post]')) return; let t = Number(cell.dataset.slot); if (plan.mode === 'month') t += 10 * 3600_000; if (t < Date.now()) t = Math.ceil((Date.now() + 15 * 60_000) / 900_000) * 900_000; openComposer({ at: t }); };
    cell.ondragover = e => { e.preventDefault(); cell.classList.add('drop'); };
    cell.ondragleave = () => cell.classList.remove('drop');
    cell.ondrop = async e => {
      e.preventDefault(); cell.classList.remove('drop');
      const p = postCache[Number(e.dataTransfer.getData('text/plain'))];
      if (!p) return;
      let at = Number(cell.dataset.slot);
      if (plan.mode === 'month') { const old = new Date(p.scheduled_at || Date.now()); at += (old.getHours() * 60 + old.getMinutes()) * 60_000; }
      else { at += new Date(p.scheduled_at || Date.now()).getMinutes() * 60_000; }
      if (at < Date.now() && p.status !== 'draft') return toast('Pick a time in the future', true);
      await tryApi('PATCH', `/api/posts/${p.id}/move`, { scheduled_at: at });
      toast('Moved to ' + fmtDT(at)); viewPlanner(v);
    };
  });
  $$('.chip[draggable]', body).forEach(ch => ch.ondragstart = e => e.dataTransfer.setData('text/plain', ch.dataset.post));
}
function chip(p) {
  const nets = [...new Set(p.targets.map(t => t.network))];
  const movable = ['scheduled', 'draft'].includes(p.status);
  return `<div class="chip ${p.status}" data-post="${p.id}" ${movable ? 'draggable="true"' : ''} title="${esc(p.text.slice(0, 200))}">${nets.slice(0, 3).map(n => netBadge(n, true)).join('')}<span class="muted">${fmtT(p.scheduled_at)}</span><span class="tx">${esc(p.text) || '(media)'}</span></div>`;
}
function monthGrid(from, month, posts) {
  const today = startOfDay(Date.now()).getTime();
  let html = '<div class="cal">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = new Date(from); d.setDate(d.getDate() + i); const ds = d.getTime();
    const dayPosts = posts.filter(p => p.scheduled_at >= ds && p.scheduled_at < ds + DAY);
    html += `<div class="day ${d.getMonth() !== month ? 'other' : ''} ${ds === today ? 'today' : ''}" data-slot="${ds}"><span class="num">${d.getDate()}</span><span class="add muted">${icon('plus', 14)}</span>${dayPosts.map(chip).join('')}</div>`;
  }
  return html + '</div>';
}
function weekGrid(from, posts) {
  const today = startOfDay(Date.now()).getTime();
  const days = [...Array(7)].map((_, i) => { const d = new Date(from); d.setDate(d.getDate() + i); return d.getTime(); });
  let html = '<div class="week"><div></div>' + days.map(d => `<div class="wh ${d === today ? 'today' : ''}">${new Date(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</div>`).join('');
  for (let h = 0; h < 24; h++) {
    html += `<div class="h">${String(h).padStart(2, '0')}:00</div>`;
    for (const d of days) {
      const s = d + h * 3600_000;
      html += `<div class="c" data-slot="${s}">${posts.filter(p => p.scheduled_at >= s && p.scheduled_at < s + 3600_000).map(chip).join('')}</div>`;
    }
  }
  return html + '</div>';
}

// ---------------- composer ----------------
async function openComposer({ post, at }) {
  const readOnly = post && ['published', 'publishing', 'partial', 'failed'].includes(post.status);
  if (!state.accounts.length) { toast('Connect an account first', true); location.hash = '#/accounts'; return; }
  const st = {
    text: post?.text || '', media: post?.media ? [...post.media] : [], overrides: { ...(post?.overrides || {}) },
    accounts: new Set(post ? post.targets.map(t => t.account_id) : store.get('lastAccounts:' + state.brandId, []).filter(id => state.accounts.some(a => a.id === id))),
    at: post?.scheduled_at || at || Math.ceil((Date.now() + 60 * 60_000) / 900_000) * 900_000,
  };
  if (readOnly) return openPostDetails(post);
  const m = modal({
    wide: true, title: post ? 'Edit post' : 'Create post',
    body: `<div class="composer"><div>
        <div class="row between" style="margin-bottom:8px"><b class="small muted">Post to</b><button class="btn sm" id="selAll" type="button">Select all accounts</button></div>
        <div class="acct-pick" id="accPick">${state.accounts.map(a => `<label data-a="${a.id}" title="${esc(a.label)} · ${esc(a.handle || '')}">${a.avatar ? `<img src="${esc(a.avatar)}" alt="">` : netBadge(a.network)}<span>${esc(a.name)}</span>${a.avatar ? netBadge(a.network, true) : ''}<input type="checkbox" value="${a.id}"></label>`).join('')}</div>
        <div class="drop-zone" id="dz"><textarea id="txt" placeholder="What do you want to share?">${esc(st.text)}</textarea></div>
        <div class="counter" id="ctr"></div>
        <div class="media-strip" id="strip"></div>
        <input type="file" id="file" multiple accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm" hidden>
        <div id="ovr"></div>
        <div id="warn" style="margin-top:10px"></div>
        <label class="f" style="margin-top:14px;max-width:260px"><span>Publish on</span><input type="datetime-local" id="when" value="${toLocalInput(st.at)}"></label>
      </div><div><h3 class="muted">Preview</h3><div class="preview" id="pv"></div></div></div>`,
    footer: `${post ? `<button class="btn danger" id="del">Delete</button><button class="btn" id="dup">Duplicate</button><span style="flex:1"></span>` : ''}
      <button class="btn" id="draft">Save draft</button><button class="btn" id="now">Publish now</button><button class="btn primary" id="sched">Schedule</button>`,
  });
  const el = m.el;
  const sel = () => state.accounts.filter(a => st.accounts.has(a.id));
  const netOf = a => state.networks.find(n => n.id === a.network);
  const textFor = a => st.overrides[a.id] ?? st.text;

  function refresh() {
    $$('#accPick label', el).forEach(l => l.classList.toggle('on', st.accounts.has(Number(l.dataset.a))));
    const s = sel();
    renderCounter();
    // media
    $('#strip', el).innerHTML = st.media.map((mm, i) => `<div class="m">${mediaTag(mm)}${mm.mime.startsWith('video/') ? '<span class="vid-badge">VIDEO</span>' : ''}<button data-rm="${i}" title="Remove">×</button></div>`).join('')
      + `<div class="m add" id="addMedia" title="Upload">+</div><div class="m add" id="libMedia" title="From library" style="font-size:12px;text-align:center">Library</div>`;
    $$('[data-rm]', el).forEach(b => b.onclick = () => { st.media.splice(Number(b.dataset.rm), 1); refresh(); });
    $('#addMedia', el).onclick = () => $('#file', el).click();
    $('#libMedia', el).onclick = () => pickFromLibrary(list => { st.media.push(...list.filter(x => !st.media.some(y => y.id === x.id))); refresh(); });
    // overrides
    $('#ovr', el).innerHTML = s.length > 1 ? s.map(a => `<details class="ovr" ${st.overrides[a.id] != null ? 'open' : ''}><summary>Customize for ${esc(a.name)} (${esc(netOf(a).label)})</summary><textarea data-ovr="${a.id}" style="min-height:70px;margin-top:6px" placeholder="Leave empty to use the main text">${esc(st.overrides[a.id] ?? '')}</textarea></details>`).join('') : '';
    $$('[data-ovr]', el).forEach(t => t.oninput = () => { if (t.value) st.overrides[t.dataset.ovr] = t.value; else delete st.overrides[t.dataset.ovr]; renderPreview(); renderWarn(); });
    renderPreview(); renderWarn();
  }
  function renderCounter() {
    const s = sel();
    $('#ctr', el).innerHTML = s.length ? [...new Map(s.map(a => [a.network, a])).values()].map(a => {
      const n = netOf(a); const lim = (st.media.length && n.limits.captionWithMedia) || n.limits.text; const len = graphemes(textFor(a));
      return `<span style="margin-left:10px" class="${len > lim ? 'over' : ''}">${esc(n.label)} ${len}/${lim}</span>`;
    }).join('') : `${graphemes(st.text)} characters`;
  }
  function warnings() {
    const w = [];
    for (const a of sel()) {
      const n = netOf(a); const tx = textFor(a);
      const lim = (st.media.length && n.limits.captionWithMedia) || n.limits.text;
      if (graphemes(tx) > lim) w.push(`${n.label}: text is ${graphemes(tx) - lim} characters too long.`);
      if (n.limits.mediaRequired && !st.media.length) w.push(`${n.label} needs at least one image or video.`);
      const imgs = st.media.filter(x => x.mime.startsWith('image/')).length;
      if (imgs > n.limits.images) w.push(`${n.label} accepts at most ${n.limits.images} images — extra ones are skipped.`);
      if (a.network === 'tiktok' && st.media.length && !st.media.some(x => x.mime.startsWith('video/')) && !state.settings.has_public_url) w.push('TikTok photo posts need a Public URL (Settings).');
      if (['instagram', 'threads'].includes(a.network) && st.media.length && !state.settings.has_public_url) w.push(`${n.label} needs a Public URL (Settings) so it can fetch your media.`);
      if (a.network === 'youtube' && !st.media.some(x => x.mime.startsWith('video/'))) w.push('YouTube needs a video. The first line of your text becomes the title.');
      if (a.network === 'pinterest' && !st.media.some(x => x.mime.startsWith('image/'))) w.push('Pinterest needs an image.');
      if (a.network === 'bluesky' && st.media.some(x => x.mime.startsWith('image/') && x.size > 1e6)) w.push('Bluesky images must be under 1 MB.');
      if (a.status === 'error') w.push(`${a.name} has a connection problem — reconnect it in Accounts.`);
    }
    return [...new Set(w)];
  }
  function renderWarn() { const w = warnings(); $('#warn', el).innerHTML = w.map(x => `<div class="pill warn" style="margin:0 6px 6px 0;white-space:normal">${esc(x)}</div>`).join(''); }
  function renderPreview() {
    const s = sel();
    const imgs = st.media.slice(0, 4);
    $('#pv', el).innerHTML = (s.length ? s : [{ name: state.me.name, handle: '', network: 'reminder' }]).map(a => `<div class="pv">
      <div class="row">${accAvatar(a, 32)}<div><b>${esc(a.name)}</b><div class="small muted">${esc(a.handle || '')} · ${fmtDT(new Date($('#when', el)?.value || st.at).getTime())}</div></div></div>
      <div class="tx">${esc(textFor(a)) || '<span class="muted">Your text appears here…</span>'}</div>
      ${imgs.length ? `<div class="imgs n${imgs.length}">${imgs.map(x => mediaTag(x)).join('')}</div>` : ''}</div>`).join('');
  }
  async function upload(files) {
    for (const f of files) {
      const t = toastProgress(`Uploading ${f.name}…`);
      try {
        const rec = await api('POST', `/api/brands/${state.brandId}/media`, f, { headers: { 'X-Filename': encodeURIComponent(f.name) } });
        st.media.push(rec); refresh();
      } catch (e) { toast(e.message, true); } finally { t.remove(); }
    }
  }
  $$('#accPick label', el).forEach(l => l.onclick = e => { e.preventDefault(); const id = Number(l.dataset.a); st.accounts.has(id) ? st.accounts.delete(id) : st.accounts.add(id); refresh(); });
  $('#txt', el).oninput = e => { st.text = e.target.value; renderCounter(); renderPreview(); renderWarn(); };
  $('#when', el).oninput = renderPreview;
  $('#file', el).onchange = e => { upload([...e.target.files]); e.target.value = ''; };
  const dz = $('#dz', el);
  dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); };
  dz.ondragleave = () => dz.classList.remove('over');
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); upload([...e.dataTransfer.files]); };
  dz.onpaste = e => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); upload(f); } };

  async function save(mode) {
    const when = new Date($('#when', el).value).getTime();
    if (mode === 'schedule' && !(when > Date.now())) return toast('Pick a time in the future', true);
    if (mode !== 'draft') { const w = warnings().filter(x => /too long|needs at least|connection problem|Public URL/.test(x)); if (w.length && !confirm('Some networks will probably fail:\n\n' + w.join('\n') + '\n\nContinue anyway?')) return; }
    const body = { brand_id: state.brandId, text: st.text, overrides: st.overrides, media_ids: st.media.map(x => x.id), account_ids: [...st.accounts], scheduled_at: when, mode };
    $$('footer button', el).forEach(b => b.disabled = true);
    try {
      await api(post ? 'PUT' : 'POST', post ? `/api/posts/${post.id}` : '/api/posts', body);
      store.set('lastAccounts:' + state.brandId, [...st.accounts]);
      toast(mode === 'draft' ? 'Draft saved' : mode === 'now' ? 'Publishing now…' : 'Scheduled for ' + fmtDT(when));
      m.close(); render();
      if (mode === 'now') setTimeout(render, 6000);
    } catch (e) { toast(e.message, true); $$('footer button', el).forEach(b => b.disabled = false); }
  }
  $('#draft', el).onclick = () => save('draft');
  $('#now', el).onclick = () => save('now');
  $('#sched', el).onclick = () => save('schedule');
  if (post) {
    $('#del', el).onclick = async () => { if (!confirm('Delete this post?')) return; await tryApi('DELETE', `/api/posts/${post.id}`); m.close(); toast('Deleted'); render(); };
    $('#dup', el).onclick = async () => { await tryApi('POST', `/api/posts/${post.id}/duplicate`); m.close(); toast('Duplicated as draft'); plan.mode = 'list'; plan.list = 'draft'; location.hash = '#/planner'; render(); };
  }
  if (!state.settings.loaded) { try { Object.assign(state.settings, await api('GET', '/api/config'), { loaded: true }); } catch { } }
  $('#selAll', el).onclick = () => { const all = st.accounts.size === state.accounts.length; st.accounts = new Set(all ? [] : state.accounts.map(a => a.id)); refresh(); };
  refresh();
  $('#txt', el).focus();
}
function toastProgress(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; $('#toasts').append(t); return t; }

function openPostDetails(post) {
  const m = modal({
    title: 'Post details',
    body: `<div class="row" style="margin-bottom:12px">${statusPill(post.status)}<span class="muted">${fmtDT(post.scheduled_at)}</span></div>
      <div style="white-space:pre-wrap;margin-bottom:12px">${esc(post.text)}</div>
      ${post.media.length ? `<div class="media-strip" style="margin-bottom:14px">${post.media.map(x => `<div class="m">${mediaTag(x)}</div>`).join('')}</div>` : ''}
      <table class="t"><thead><tr><th>Account</th><th>Status</th><th class="n">Likes</th><th class="n">Comments</th><th class="n">Shares</th><th></th></tr></thead><tbody>
      ${post.targets.map(t => `<tr><td><div class="row">${netBadge(t.network, true)}${esc(t.account_name)}</div>${t.error ? `<div class="small down" style="max-width:280px">${esc(t.error)}</div>` : ''}</td>
        <td>${statusPill(t.status)}</td><td class="n">${fmtN(t.likes)}</td><td class="n">${fmtN(t.comments)}</td><td class="n">${fmtN(t.shares)}</td>
        <td>${t.remote_url ? `<a href="${esc(t.remote_url)}" target="_blank" rel="noopener" title="Open">${icon('ext', 16)}</a>` : ''}</td></tr>`).join('')}
      </tbody></table>`,
    footer: `<button class="btn danger" id="del">Delete from Socialdesk</button><button class="btn" id="dup">Duplicate</button>${post.targets.some(t => t.status === 'failed') ? '<button class="btn primary" id="retry">Retry failed</button>' : ''}`,
  });
  $('#del', m.el).onclick = async () => { if (!confirm('Remove this post from Socialdesk? (It stays on the networks.)')) return; await tryApi('DELETE', `/api/posts/${post.id}`); m.close(); render(); };
  $('#dup', m.el).onclick = async () => { await tryApi('POST', `/api/posts/${post.id}/duplicate`); m.close(); toast('Duplicated as draft'); plan.mode = 'list'; plan.list = 'draft'; location.hash = '#/planner'; render(); };
  if ($('#retry', m.el)) $('#retry', m.el).onclick = async () => { await tryApi('POST', `/api/posts/${post.id}/retry`); m.close(); toast('Retrying…'); setTimeout(render, 5000); };
}

async function pickFromLibrary(cb) {
  const items = await api('GET', `/api/brands/${state.brandId}/media`);
  const chosen = new Set();
  const m = modal({
    title: 'Media library',
    body: items.length ? `<div class="lib">${items.map(x => `<div class="m" data-id="${x.id}">${mediaTag(x)}${x.mime.startsWith('video/') ? '<span class="vid-badge">VIDEO</span>' : ''}</div>`).join('')}</div>` : '<div class="empty">No media yet. Upload files in the composer.</div>',
    footer: '<button class="btn primary" id="use">Add selected</button>',
  });
  $$('.lib .m', m.el).forEach(d => d.onclick = () => { const id = Number(d.dataset.id); chosen.has(id) ? chosen.delete(id) : chosen.add(id); d.classList.toggle('on'); });
  $('#use', m.el).onclick = () => { cb(items.filter(x => chosen.has(x.id))); m.close(); };
}

// ---------------- analytics ----------------
let anDays = store.get('anDays', 30);
async function viewAnalytics(v) {
  const a = await api('GET', `/api/brands/${state.brandId}/analytics?days=${anDays}`);
  const t = a.totals;
  const colorOf = c => (c === '#000000' || c === '#111111') ? 'var(--text)' : c;
  const byNet = {};
  for (const p of a.posts) { byNet[p.network] = byNet[p.network] || { e: 0, n: 0 }; byNet[p.network].e += p.engagement; byNet[p.network].n++; }
  // best-time heatmap (local time)
  const grid = [...Array(7)].map(() => [...Array(24)].map(() => ({ s: 0, n: 0 })));
  for (const [ts, e] of a.published) { const d = new Date(ts); const g = grid[(d.getDay() + 6) % 7][d.getHours()]; g.s += e; g.n++; }
  const avg = grid.map(r => r.map(c => c.n ? c.s / c.n : null));
  const mx = Math.max(1, ...avg.flat().filter(x => x != null));
  let best = null; avg.forEach((r, di) => r.forEach((x, h) => { if (x != null && (!best || x > best.v)) best = { v: x, di, h }; }));
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const top = [...a.posts].sort((x, y) => y.engagement - x.engagement);
  v.innerHTML = `
  <div class="head"><h1>Analytics</h1><div class="actions">
    <div class="tabs" id="days">${[7, 30, 90, 365].map(d => `<button data-d="${d}" class="${anDays === d ? 'on' : ''}">${d === 365 ? '1y' : d + 'd'}</button>`).join('')}</div>
    <button class="btn" id="refresh">Refresh now</button>
    <a class="btn" href="/api/brands/${state.brandId}/analytics.csv?days=${anDays}">Export CSV</a>
    <button class="btn" onclick="print()">Print report</button></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><div class="muted">Followers</div><div class="v">${fmtN(t.followers)}</div><div class="d ${t.followerChange >= 0 ? 'up' : 'down'}">${t.followerChange >= 0 ? '+' : ''}${fmtN(t.followerChange)}</div></div>
    <div class="card kpi"><div class="muted">Posts</div><div class="v">${fmtN(t.posts)}</div></div>
    <div class="card kpi"><div class="muted">Interactions</div><div class="v">${fmtN(t.likes + t.comments + t.shares)}</div><div class="d muted">${fmtN(t.likes)} likes · ${fmtN(t.comments)} comments · ${fmtN(t.shares)} shares</div></div>
    <div class="card kpi"><div class="muted">Views</div><div class="v">${t.views ? fmtN(t.views) : '—'}</div><div class="d muted">where the network reports them</div></div>
  </div>
  <div class="card" style="margin-bottom:16px"><h2>Followers over time</h2>
    ${lineChart(a.accounts.filter(x => x.series.some(s => s.followers != null)).map(x => ({ name: `${x.name} (${x.label})`, color: colorOf(x.color), points: x.series.filter(s => s.followers != null).map(s => [new Date(s.day).getTime(), s.followers]) })))}</div>
  <div class="grid g2" style="margin-bottom:16px">
    <div class="card"><h2>Accounts</h2><table class="t"><thead><tr><th>Account</th><th class="n">Followers</th><th class="n">Change</th></tr></thead><tbody>
      ${a.accounts.map(x => `<tr><td><div class="row">${accAvatar(x, 28)}<div><div>${esc(x.name)}</div><div class="small muted">${esc(x.label)}</div></div></div></td><td class="n">${fmtN(x.followers)}</td><td class="n ${x.change > 0 ? 'up' : x.change < 0 ? 'down' : ''}">${x.change == null ? '—' : (x.change > 0 ? '+' : '') + fmtN(x.change)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No accounts</td></tr>'}
    </tbody></table></div>
    <div class="card"><h2>Engagement by network</h2>${barChart(Object.entries(byNet).map(([k, x]) => ({ label: state.networks.find(n => n.id === k)?.label || k, value: x.e, color: colorOf(state.networks.find(n => n.id === k)?.color) })))}</div>
  </div>
  <div class="card" style="margin-bottom:16px"><div class="row between wrap"><h2>Best time to post</h2>${best ? `<span class="pill ok">Your best slot so far: ${DOW[best.di]} around ${String(best.h).padStart(2, '0')}:00</span>` : ''}</div>
    <p class="muted small" style="margin-top:0">Average interactions of your own posts by weekday and hour (your local time). Gets more accurate as you publish more.</p>
    <div class="heat">${DOW.map((d, di) => `<span class="lbl">${d}</span>` + avg[di].map((x, h) => `<div title="${d} ${h}:00 — ${x == null ? 'no posts' : x.toFixed(1) + ' avg interactions'}" style="background:${x == null ? 'var(--panel-2)' : `color-mix(in srgb, var(--accent) ${Math.round(15 + 85 * x / mx)}%, transparent)`}"></div>`).join('')).join('')}
      <span></span>${[...Array(24)].map((_, h) => `<span style="text-align:center">${h % 3 ? '' : h}</span>`).join('')}</div></div>
  <div class="card"><h2>Published posts</h2><div style="overflow:auto"><table class="t"><thead><tr><th></th><th>Post</th><th class="hide-sm">Date</th><th class="n">Likes</th><th class="n">Comments</th><th class="n">Shares</th><th class="n hide-sm">Views</th><th></th></tr></thead><tbody>
    ${top.map(p => `<tr><td>${p.thumb ? mediaTag(p.thumb, 'class="thumb"') : netBadge(p.network)}</td><td><div class="clip">${esc(p.text) || '(media)'}</div><div class="small muted row" style="gap:5px">${netBadge(p.network, true)}${esc(p.account_name)}</div></td>
      <td class="hide-sm small">${fmtDT(p.published_at)}</td><td class="n">${fmtN(p.likes)}</td><td class="n">${fmtN(p.comments)}</td><td class="n">${fmtN(p.shares)}</td><td class="n hide-sm">${fmtN(p.views)}</td>
      <td>${p.remote_url ? `<a href="${esc(p.remote_url)}" target="_blank" rel="noopener">${icon('ext', 16)}</a>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No published posts in this period.</td></tr>'}
  </tbody></table></div></div>`;
  $$('#days button', v).forEach(b => b.onclick = () => { anDays = Number(b.dataset.d); store.set('anDays', anDays); viewAnalytics(v); });
  $('#refresh', v).onclick = async e => { e.target.disabled = true; e.target.textContent = 'Refreshing…'; try { await api('POST', `/api/brands/${state.brandId}/analytics/refresh`); toast('Stats updated'); } catch (er) { toast(er.message, true); } viewAnalytics(v); };
}

// ---------------- accounts ----------------
async function viewAccounts(v) {
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  if (qs.get('connected') || qs.get('error')) {
    qs.get('connected') ? toast('Connected: ' + qs.get('connected')) : toast(qs.get('error'), true);
    history.replaceState(null, '', '#/accounts');
    await loadBrand();
  }
  v.innerHTML = `
  <div class="head"><div><h1>Accounts</h1><div class="muted">Social profiles connected to ${esc(brand()?.name)}</div></div>
    <div class="actions"><button class="btn primary" id="add">${icon('plus', 16)}Connect account</button></div></div>
  <div class="grid g3">${state.accounts.map(a => `<div class="card">
      <div class="row">${accAvatar(a, 44)}<div style="min-width:0;flex:1"><b>${esc(a.name)}</b><div class="small muted clip">${esc(a.label)} · ${esc(a.handle || '')}</div></div></div>
      <div style="margin:12px 0">${a.status === 'error' ? `<span class="pill bad">Needs reconnect</span><div class="small down" style="margin-top:6px">${esc(a.last_error || '')}</div>` : a.manual ? '<span class="pill warn">Reminder mode</span>' : '<span class="pill ok">Connected</span>'}</div>
      <div class="row"><button class="btn sm" data-edit="${a.id}">Update credentials</button><button class="btn sm danger" data-del="${a.id}">Remove</button></div></div>`).join('')
    || '<div class="card empty" style="grid-column:1/-1">No accounts yet. Click <b>Connect account</b> to add one.</div>'}</div>`;
  $('#add', v).onclick = () => connectModal();
  $$('[data-edit]', v).forEach(b => b.onclick = () => { const a = state.accounts.find(x => x.id === Number(b.dataset.edit)); connectModal(a.network, a); });
  $$('[data-del]', v).forEach(b => b.onclick = async () => {
    if (!confirm('Remove this account? Its scheduled posts will no longer go to it.')) return;
    await tryApi('DELETE', `/api/accounts/${b.dataset.del}`); await loadBrand(); render();
  });
}
function oauthGo(provider, extra = '') {
  location.href = `/api/oauth/start/${provider}?brand=${state.brandId}${extra}`;
}
function connectModal(netId, existing, forceManual) {
  if (!netId) {
    // one tile per login provider (Facebook + Instagram share one login)
    const seen = new Set();
    const tiles = state.networks.filter(n => { const k = n.oauth?.provider === 'meta' ? 'meta' : n.id; if (seen.has(k)) return false; seen.add(k); return true; });
    const sub = n => n.manual ? 'Reminder (no API)' : n.oauth?.configured ? 'One-click login' : n.oauth ? 'Login not set up yet — paste a token' : 'Free · quick setup';
    const m = modal({
      title: 'Connect your accounts',
      body: `<p class="muted" style="margin-top:0">Log in to each network once. After that you can post to all of them at the same time.</p>
        <div class="grid g2">${tiles.map(n => `<button class="btn" data-n="${n.id}" style="justify-content:flex-start;padding:12px;white-space:normal">${n.oauth?.provider === 'meta' ? netBadge('facebook') + netBadge('instagram') : netBadge(n.id)} <span style="text-align:left">${esc(n.oauth?.provider === 'meta' ? 'Facebook & Instagram' : n.label)}<br><span class="small ${n.oauth?.configured ? 'up' : 'muted'}">${sub(n)}</span></span></button>`).join('')}</div>`,
    });
    $$('[data-n]', m.el).forEach(b => b.onclick = () => { m.close(); connectModal(b.dataset.n); });
    return;
  }
  const n = state.networks.find(x => x.id === netId);
  if (!existing && !forceManual && n.oauth) {
    const name = n.oauth.provider === 'meta' ? 'Facebook & Instagram' : n.oauth.label;
    if (n.oauth.provider === 'mastodon') {
      const m = modal({
        title: 'Connect Mastodon',
        body: `<label class="f"><span>Your Mastodon server</span><input type="text" id="inst" placeholder="mastodon.social"></label><p class="small muted">You will be sent to your server to approve access. No developer app needed.</p>`,
        footer: `<button class="btn" id="man">Paste a token instead</button><button class="btn primary" id="go">Continue</button>`,
      });
      $('#go', m.el).onclick = () => { const i = $('#inst', m.el).value.trim(); if (!i) return toast('Enter your server', true); oauthGo('mastodon', '&instance=' + encodeURIComponent(i)); };
      $('#man', m.el).onclick = () => { m.close(); connectModal(netId, null, true); };
      return;
    }
    if (n.oauth.configured) {
      const m = modal({
        title: `Connect ${esc(name)}`,
        body: `<p>You'll be sent to ${esc(name)} to log in and approve Socialdesk. ${n.oauth.provider === 'meta' ? 'Pick <b>all the Pages</b> (and their Instagram accounts) you want — each one is added automatically.' : n.oauth.provider === 'linkedin' ? 'Your profile (and company pages you manage, if allowed) are added.' : n.oauth.provider === 'pinterest' ? 'Each of your boards is added as a separate destination.' : ''}</p>`,
        footer: `<button class="btn" id="man">Paste a token instead</button><button class="btn primary" id="go">Continue with ${esc(name)}</button>`,
      });
      $('#go', m.el).onclick = () => oauthGo(n.oauth.provider);
      $('#man', m.el).onclick = () => { m.close(); connectModal(netId, null, true); };
      return;
    }
  }
  const setupNote = n.oauth && !n.oauth.configured && n.oauth.provider !== 'mastodon'
    ? `<div class="card" style="margin-bottom:14px;padding:12px;border-color:var(--warn)"><b>One-click login for ${esc(n.oauth.label)} isn't set up on this server yet.</b><br><span class="small muted">${state.me.is_super ? 'Add your app keys in <a href="#/settings" data-close3>Settings → Integrations</a> to enable the "Continue with…" button for everyone.' : 'Ask your server administrator to enable it, or paste a token below.'}</span></div>` : '';
  const m = modal({
    title: `${existing ? 'Update' : 'Connect'} ${esc(n.label)}`,
    body: `${setupNote}<form id="cf">${n.fields.map(f => `<label class="f"><span>${esc(f.label)}</span><input type="${f.type === 'password' ? 'password' : 'text'}" name="${f.key}" placeholder="${esc(existing && f.type === 'password' ? '•••••• (unchanged)' : f.placeholder || '')}" autocomplete="off">${f.help ? `<small>${esc(f.help)}</small>` : ''}</label>`).join('')}
      <p class="small muted">Credentials are encrypted and stored only on this server.</p></form>`,
    footer: `${existing && n.oauth?.configured && n.oauth.provider !== 'mastodon' ? `<button class="btn" id="relog">Log in again with ${esc(n.oauth.label)}</button><span style="flex:1"></span>` : ''}<button class="btn" data-close2>Cancel</button><button class="btn primary" id="go">${existing ? 'Save' : 'Connect'}</button>`,
  });
  $$('[data-close3]', m.el).forEach(a => a.onclick = () => m.close());
  if ($('#relog', m.el)) $('#relog', m.el).onclick = () => oauthGo(n.oauth.provider);
  $('[data-close2]', m.el).onclick = m.close;
  $('#go', m.el).onclick = async e => {
    const credentials = Object.fromEntries(new FormData($('#cf', m.el)));
    e.target.disabled = true; e.target.textContent = 'Checking…';
    try {
      if (existing) await api('PUT', `/api/accounts/${existing.id}`, { credentials });
      else await api('POST', '/api/accounts', { brand_id: state.brandId, network: netId, credentials });
      m.close(); toast(`${n.label} connected`); await loadBrand(); render();
    } catch (er) { toast(er.message, true); e.target.disabled = false; e.target.textContent = existing ? 'Save' : 'Connect'; }
  };
}

// ---------------- link in bio ----------------
async function viewBio(v) {
  const d = await api('GET', `/api/brands/${state.brandId}/bio`);
  const st = { title: d.title || brand().name, bio: d.bio || '', theme: d.theme || brand().color, dark: !!d.dark, showPosts: d.showPosts ?? true, links: d.links || [], avatar: d.avatar || null, slug: d.slug };
  const url = () => `${location.origin}/bio/${st.slug}`;
  v.innerHTML = `
  <div class="head"><div><h1>Link in bio</h1><div class="muted">A free landing page for your profile links</div></div>
    <div class="actions"><a class="btn" id="open" target="_blank" rel="noopener">${icon('ext', 16)}Open page</a><button class="btn" id="copy">Copy link</button><button class="btn primary" id="save">Save</button></div></div>
  <div class="grid g2"><div class="card">
    <label class="f"><span>Page address</span><div class="row"><span class="muted small">${esc(location.origin)}/bio/</span><input type="text" id="slug" value="${esc(st.slug)}"></div></label>
    <label class="f"><span>Title</span><input type="text" id="title" value="${esc(st.title)}"></label>
    <label class="f"><span>Bio</span><textarea id="bio" style="min-height:70px">${esc(st.bio)}</textarea></label>
    <div class="row wrap" style="margin-bottom:12px"><label class="row">Theme <input type="color" id="theme" value="${esc(st.theme)}"></label>
      <label class="row"><input type="checkbox" id="dark" ${st.dark ? 'checked' : ''}> Dark</label>
      <label class="row"><input type="checkbox" id="showPosts" ${st.showPosts ? 'checked' : ''}> Show latest posts grid</label>
      <button class="btn sm" id="avatar">Choose avatar</button></div>
    <h3>Links</h3><div id="links"></div><button class="btn sm" id="addLink">${icon('plus', 14)}Add link</button>
    ${location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? '<p class="small muted" style="margin-top:14px">To share this page publicly, expose Socialdesk with a free tunnel and set the Public URL in Settings (see README).</p>' : ''}
  </div><div><div class="phone"><iframe id="pvf" title="Preview"></iframe></div></div></div>`;
  const drawLinks = () => {
    $('#links', v).innerHTML = st.links.map((l, i) => `<div class="link-row"><input type="text" data-k="label" data-i="${i}" placeholder="Label" value="${esc(l.label)}"><input type="url" data-k="url" data-i="${i}" placeholder="https://" value="${esc(l.url)}"><button class="icon-btn" data-rm="${i}">${icon('x', 16)}</button></div>`).join('');
    $$('#links input', v).forEach(inp => inp.oninput = () => { st.links[inp.dataset.i][inp.dataset.k] = inp.value; });
    $$('#links [data-rm]', v).forEach(b => b.onclick = () => { st.links.splice(Number(b.dataset.rm), 1); drawLinks(); });
  };
  drawLinks();
  const reload = () => { $('#pvf', v).src = `/bio/${st.slug}?t=${Date.now()}`; $('#open', v).href = url(); };
  reload();
  $('#addLink', v).onclick = () => { st.links.push({ label: '', url: '' }); drawLinks(); };
  $('#avatar', v).onclick = () => pickFromLibrary(list => { if (list[0]) { st.avatar = list[0].filename; toast('Avatar selected — save to apply'); } });
  $('#copy', v).onclick = () => { navigator.clipboard?.writeText(url()); toast('Link copied'); };
  $('#save', v).onclick = async () => {
    Object.assign(st, { slug: $('#slug', v).value, title: $('#title', v).value, bio: $('#bio', v).value, theme: $('#theme', v).value, dark: $('#dark', v).checked, showPosts: $('#showPosts', v).checked });
    const bad = st.links.filter(l => l.label && l.url && !/^(https?:|mailto:|tel:)/.test(l.url));
    if (bad.length) return toast('Links must start with https://, mailto: or tel:', true);
    const r = await tryApi('PUT', `/api/brands/${state.brandId}/bio`, st);
    st.slug = r.slug; $('#slug', v).value = r.slug; toast('Saved'); reload();
  };
}

// ---------------- reminders ----------------
async function viewReminders(v) {
  await loadBrand();
  const list = state.remindersList;
  const openUrl = { snapchat: 'https://www.snapchat.com/', instagram: 'https://www.instagram.com/', tiktok: 'https://www.tiktok.com/upload' };
  v.innerHTML = `
  <div class="head"><div><h1>Reminders</h1><div class="muted">Posts for networks without a posting API. Download the media, copy the caption, post it, then mark it done.</div></div></div>
  <div class="grid g2">${list.map(r => `<div class="card">
    <div class="row between"><div class="row">${netBadge(r.network)}<b>${esc(r.account_name)}</b></div><span class="small muted">due ${fmtDT(r.due_at)}</span></div>
    <div style="white-space:pre-wrap;margin:12px 0;max-height:180px;overflow:auto" class="card" >${esc(r.text) || '<span class="muted">(no caption)</span>'}</div>
    ${r.media.length ? `<div class="media-strip" style="margin-bottom:12px">${r.media.map(x => `<a class="m" href="/media/${x.filename}" download="${esc(x.original_name)}" title="Download">${mediaTag(x)}</a>`).join('')}</div>` : ''}
    <div class="row wrap"><button class="btn sm" data-copy="${r.target_id}">Copy caption</button>
      ${r.media.length ? `<button class="btn sm" data-dl="${r.target_id}">Download media</button>` : ''}
      ${openUrl[r.network] ? `<a class="btn sm" href="${openUrl[r.network]}" target="_blank" rel="noopener">Open ${esc(r.network)}</a>` : ''}
      <span style="flex:1"></span><button class="btn sm primary" data-done="${r.target_id}">Mark as posted</button></div></div>`).join('')
    || '<div class="card empty" style="grid-column:1/-1">Nothing to post manually right now. 🎉</div>'}</div>`;
  $$('[data-copy]', v).forEach(b => b.onclick = () => { const r = list.find(x => x.target_id === Number(b.dataset.copy)); navigator.clipboard?.writeText(r.text); toast('Caption copied'); });
  $$('[data-dl]', v).forEach(b => b.onclick = () => { const r = list.find(x => x.target_id === Number(b.dataset.dl)); r.media.forEach((x, i) => setTimeout(() => { const a = document.createElement('a'); a.href = '/media/' + x.filename; a.download = x.original_name; a.click(); }, i * 400)); });
  $$('[data-done]', v).forEach(b => b.onclick = async () => {
    const url = prompt('Link to the published post (optional):', '');
    if (url === null) return;
    await tryApi('POST', `/api/targets/${b.dataset.done}/done`, { url });
    toast('Marked as posted'); render();
  });
}

// ---------------- settings ----------------
async function viewSettings(v) {
  const admin = ['owner', 'admin'].includes(state.me.role);
  const users = admin ? await api('GET', '/api/users') : [];
  v.innerHTML = `
  <div class="head"><h1>Settings</h1>${state.me.is_super ? '<a class="btn" href="#/server">Server admin & integrations</a>' : ''}</div>
  <div class="grid g2">
    <div class="card"><h2>Workspace</h2>
      <label class="f"><span>Company name</span><input type="text" id="oname" value="${esc(state.me.org_name)}" ${admin ? '' : 'disabled'}></label>
      ${admin ? '<button class="btn primary" id="saveOrg">Save</button>' : ''}
      <p class="small muted">Each workspace has its own brands, accounts, posts and team. Use brands for each client or product.</p></div>
    <div class="card"><h2>Brand</h2>
      <label class="f"><span>Name</span><input type="text" id="bname" value="${esc(brand().name)}"></label>
      <label class="f row"><span style="margin:0">Color</span><input type="color" id="bcolor" value="${esc(brand().color)}"></label>
      <div class="row"><button class="btn primary" id="saveBrand">Save brand</button>${admin && state.brands.length > 1 ? '<button class="btn danger" id="delBrand">Delete brand</button>' : ''}</div></div>
    ${admin ? `<div class="card"><h2>Team</h2><table class="t"><tbody>${users.map(u => `<tr><td><b>${esc(u.name)}</b><div class="small muted">${esc(u.email)}</div></td><td><span class="pill">${u.role}</span></td><td>${u.id !== state.me.id ? `<button class="btn sm danger" data-du="${u.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <form id="uf" style="margin-top:14px"><div class="grid g2"><input type="text" name="name" placeholder="Name" required><input type="email" name="email" placeholder="Email" required>
      <input type="password" name="password" placeholder="Password (8+)" minlength="8" required><select name="role"><option value="editor">Editor</option><option value="admin">Admin</option></select></div>
      <button class="btn" style="margin-top:10px">Add team member</button></form></div>` : ''}
    <div class="card"><h2>Your password</h2><form id="pf"><label class="f"><span>Current</span><input type="password" name="current" required></label><label class="f"><span>New</span><input type="password" name="next" minlength="8" required></label><button class="btn">Change password</button></form></div>
  </div>`;
  if (admin) {
    $('#saveOrg', v).onclick = async () => { await tryApi('PUT', '/api/org', { name: $('#oname', v).value }); state.me.org_name = $('#oname', v).value; toast('Saved'); };
    $('#uf', v).onsubmit = async e => { e.preventDefault(); await tryApi('POST', '/api/users', Object.fromEntries(new FormData(e.target))); toast('User added'); viewSettings(v); };
    $$('[data-du]', v).forEach(b => b.onclick = async () => { if (confirm('Remove this user?')) { await tryApi('DELETE', `/api/users/${b.dataset.du}`); viewSettings(v); } });
    if ($('#delBrand', v)) $('#delBrand', v).onclick = async () => {
      if (prompt(`Type the brand name "${brand().name}" to delete it with all its posts, media and accounts:`) !== brand().name) return;
      await tryApi('DELETE', `/api/brands/${state.brandId}`); state.brands = []; state.brandId = null; render();
    };
  }
  $('#saveBrand', v).onclick = async () => { await tryApi('PUT', `/api/brands/${state.brandId}`, { name: $('#bname', v).value, color: $('#bcolor', v).value }); state.brands = await api('GET', '/api/brands'); toast('Saved'); render(); };
  $('#pf', v).onsubmit = async e => { e.preventDefault(); await tryApi('PUT', '/api/me/password', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast('Password changed'); };
}

// ---------------- server admin (platform owner only) ----------------
async function viewServer(v) {
  if (!state.me.is_super) { v.innerHTML = '<div class="card empty">Only the server administrator can open this page.</div>'; return; }
  const p = await api('GET', '/api/platform');
  const local = /localhost|127\.0\.0\.1/.test(p.public_url) || !p.public_url;
  v.innerHTML = `
  <div class="head"><div><h1>Server admin</h1><div class="muted">${p.stats.orgs} workspaces · ${p.stats.users} users · ${p.stats.accounts} accounts · ${p.stats.posts} posts published</div></div></div>
  <div class="grid g2" style="margin-bottom:16px">
    <div class="card"><h2>Public URL</h2>
      <p class="muted small" style="margin-top:0">The internet address of this server. Login buttons send people back here, and Instagram/Threads/TikTok download your media from it. On your own PC, run a free tunnel such as <code>cloudflared tunnel --url http://localhost:3000</code> and paste its https address.</p>
      <label class="f"><input type="url" id="pub" value="${esc(p.public_url)}" placeholder="https://social.yourcompany.com" ${p.public_url_from_env ? 'disabled' : ''}>${p.public_url_from_env ? '<small>Set by the PUBLIC_URL environment variable.</small>' : ''}</label>
      ${p.public_url_from_env ? '' : '<button class="btn primary" id="savePub">Save</button>'}</div>
    <div class="card"><h2>Sign-ups</h2>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" id="signup" ${p.allow_signup ? 'checked' : ''}> Anyone can create a free workspace on this server</label>
      <p class="small muted">Turn this off for a private company install. You can still add teammates from Settings → Team.</p></div>
  </div>
  ${local ? '<div class="card" style="margin-bottom:16px;border-color:var(--warn)"><b>Tip:</b> most login providers (TikTok, Meta, Pinterest) require an <b>https</b> Redirect URI. Set a public https URL above first, then copy the Redirect URIs below.</div>' : ''}
  <h2>Integrations — one-click login buttons</h2>
  <p class="muted" style="margin-top:-4px">Each network requires you to register a free developer app once. After you paste its keys here, every user on this server gets a "Continue with…" button. Bluesky, Mastodon, Telegram and Discord need nothing here.</p>
  <div class="grid g2">${p.integrations.map(i => `<div class="card">
    <div class="row between"><div class="row">${i.networks.map(n => netBadge(n)).join('')}<b>${esc(i.label)}</b></div>${i.configured ? `<span class="pill ok">Enabled${i.source === 'env' ? ' (env)' : ''}</span>` : '<span class="pill">Not set up</span>'}</div>
    <ol class="small muted" style="padding-left:18px">${i.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
    <label class="f"><span>Redirect URI</span><div class="row"><input type="text" readonly value="${esc(i.redirectUri)}"><button class="btn sm" data-copy="${esc(i.redirectUri)}">Copy</button></div></label>
    ${i.source === 'env' ? `<p class="small muted">Configured with ${i.env}_CLIENT_ID / ${i.env}_CLIENT_SECRET.</p>` : `
    <div class="grid g2"><input type="text" data-id="${i.id}" data-k="clientId" placeholder="Client / App ID" value="${esc(i.clientId)}"><input type="password" data-id="${i.id}" data-k="clientSecret" placeholder="${i.configured ? '•••••• (unchanged)' : 'Client secret'}"></div>
    <div class="row" style="margin-top:10px"><a class="btn sm" href="${esc(i.portal)}" target="_blank" rel="noopener">${icon('ext', 14)}Developer portal</a><span style="flex:1"></span>${i.configured ? `<button class="btn sm danger" data-clear="${i.id}">Remove</button>` : ''}<button class="btn sm primary" data-save="${i.id}">Save</button></div>`}
  </div>`).join('')}</div>`;
  if ($('#savePub', v)) $('#savePub', v).onclick = async () => { await tryApi('PUT', '/api/platform', { public_url: $('#pub', v).value }); toast('Saved'); state.settings.loaded = false; viewServer(v); };
  $('#signup', v).onchange = async e => { await tryApi('PUT', '/api/platform', { allow_signup: e.target.checked }); toast(e.target.checked ? 'Sign-ups open' : 'Sign-ups closed'); };
  $$('[data-copy]', v).forEach(b => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Copied'); });
  $$('[data-save]', v).forEach(b => b.onclick = async () => {
    const id = b.dataset.save, val = k => $(`[data-id="${id}"][data-k="${k}"]`, v).value.trim();
    await tryApi('PUT', '/api/platform', { integration: { id, clientId: val('clientId'), clientSecret: val('clientSecret') } });
    state.networks = await api('GET', '/api/networks'); toast('Saved'); viewServer(v);
  });
  $$('[data-clear]', v).forEach(b => b.onclick = async () => {
    if (!confirm('Remove these keys? Accounts already connected keep working until their token expires.')) return;
    await tryApi('PUT', '/api/platform', { integration: { id: b.dataset.clear, clear: true } }); state.networks = await api('GET', '/api/networks'); viewServer(v);
  });
}

// keep the planner/dashboard fresh while posts are publishing
setInterval(() => { if (state.me && ['/', '/planner'].includes(route()) && !$('.modal-bg')) { if ($$('.pubbing, .chip.publishing').length) render(); } }, 15000);

render();
