'use strict';
const crypto = require('node:crypto');
const { json, fileBlob, isVideo, sleep } = require('./util');

const pct = s => encodeURIComponent(s).replace(/[!'()*]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase());

// OAuth 1.0a user-context signature (query params are signed; JSON/multipart bodies are not)
function oauthHeader(c, method, url) {
  const u = new URL(url);
  const o = {
    oauth_consumer_key: c.apiKey, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: c.accessToken, oauth_version: '1.0',
  };
  const params = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : (a[0] < b[0] ? -1 : 1));
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(params.map(p => p.join('=')).join('&'))].join('&');
  o.oauth_signature = crypto.createHmac('sha1', pct(c.apiSecret) + '&' + pct(c.accessSecret)).update(base).digest('base64');
  return 'OAuth ' + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ');
}
// Accounts connected with the "Continue with X" button use OAuth 2.0 bearer tokens (auto-refreshed);
// accounts added by pasting keys use OAuth 1.0a.
async function call(c, method, url, body) {
  if (c.oauth2) {
    const o = require('../oauth');
    if (o.soon(c)) await o.refreshX(c);
    return json(url, { method, body, headers: { Authorization: `Bearer ${c.accessToken}` } });
  }
  return json(url, { method, body, headers: { Authorization: oauthHeader(c, method, url) } });
}

async function uploadMedia(c, m) {
  const UP = 'https://api.x.com/2/media/upload';
  if (!isVideo(m)) {
    const fd = new FormData();
    fd.append('media', fileBlob(m), m.original_name);
    fd.append('media_category', m.mime === 'image/gif' ? 'tweet_gif' : 'tweet_image');
    return (await call(c, 'POST', UP, fd)).data.id;
  }
  // chunked upload for video
  const init = await call(c, 'POST', `${UP}/initialize`, { media_type: m.mime, total_bytes: m.size, media_category: 'tweet_video' });
  const id = init.data.id;
  const buf = require('node:fs').readFileSync(m.path);
  const CH = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < buf.length; i += CH, seg++) {
    const fd = new FormData();
    fd.append('media', new Blob([buf.subarray(i, i + CH)]), 'chunk');
    fd.append('segment_index', String(seg));
    await call(c, 'POST', `${UP}/${id}/append`, fd);
  }
  let fin = await call(c, 'POST', `${UP}/${id}/finalize`);
  let info = fin.data?.processing_info;
  while (info && ['pending', 'in_progress'].includes(info.state)) {
    await sleep((info.check_after_secs || 3) * 1000);
    info = (await call(c, 'GET', `${UP}?media_id=${id}&command=STATUS`)).data?.processing_info;
  }
  if (info?.state === 'failed') throw new Error('X video processing failed');
  return id;
}

module.exports = {
  id: 'x', label: 'X (Twitter)', color: '#111111',
  limits: { text: 280, images: 4, video: true },
  fields: [
    { key: 'apiKey', label: 'API key (consumer key)' },
    { key: 'apiSecret', label: 'API key secret', type: 'password' },
    { key: 'accessToken', label: 'Access token', help: 'In the X developer portal set the app to "Read and write" BEFORE generating the access token.' },
    { key: 'accessSecret', label: 'Access token secret', type: 'password' },
  ],
  async verify(c) {
    const r = await call(c, 'GET', 'https://api.x.com/2/users/me?user.fields=profile_image_url');
    c.username = r.data.username;
    return { name: r.data.name, handle: '@' + r.data.username, avatar: r.data.profile_image_url || null };
  },
  async publish(c, post) {
    const body = { text: post.text };
    const ids = [];
    const vid = post.media.find(isVideo);
    for (const m of vid ? [vid] : post.media.slice(0, 4)) ids.push(await uploadMedia(c, m));
    if (ids.length) body.media = { media_ids: ids };
    const r = await call(c, 'POST', 'https://api.x.com/2/tweets', body);
    return { remoteId: r.data.id, url: `https://x.com/${c.username || 'i'}/status/${r.data.id}` };
  },
  async stats(c) {
    const r = await call(c, 'GET', 'https://api.x.com/2/users/me?user.fields=public_metrics');
    const m = r.data.public_metrics || {};
    return { followers: m.followers_count, following: m.following_count, posts: m.tweet_count };
  },
  async metrics(c, id) {
    const r = await call(c, 'GET', `https://api.x.com/2/tweets/${id}?tweet.fields=public_metrics`);
    const m = r.data.public_metrics || {};
    return { likes: m.like_count, comments: m.reply_count, shares: (m.retweet_count || 0) + (m.quote_count || 0), views: m.impression_count };
  },
};
