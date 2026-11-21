'use strict';
const fs = require('node:fs');
const { json, request, isImage, isVideo } = require('./util');

const PUBLIC = 'https://public.api.bsky.app/xrpc';

function host(c) { return (c.service || 'https://bsky.social').replace(/\/$/, ''); }

async function session(c) {
  const s = await json(`${host(c)}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', body: { identifier: c.handle, password: c.appPassword },
  });
  return s;
}

// Build link + hashtag facets (byte offsets in UTF-8)
function facets(text) {
  const out = [];
  const enc = new TextEncoder();
  const byteIdx = i => enc.encode(text.slice(0, i)).length;
  const urlRe = /https?:\/\/[^\s)\]]+/g;
  let m;
  while ((m = urlRe.exec(text))) {
    const uri = m[0].replace(/[.,;:!?]+$/, '');
    out.push({ index: { byteStart: byteIdx(m.index), byteEnd: byteIdx(m.index + uri.length) },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }] });
  }
  const tagRe = /(^|\s)#([\p{L}\p{N}_]+)/gu;
  while ((m = tagRe.exec(text))) {
    const start = m.index + m[1].length;
    out.push({ index: { byteStart: byteIdx(start), byteEnd: byteIdx(start + 1 + m[2].length) },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return out;
}

module.exports = {
  id: 'bluesky', label: 'Bluesky', color: '#1185fe',
  limits: { text: 300, images: 4, video: true },
  fields: [
    { key: 'handle', label: 'Handle', placeholder: 'you.bsky.social' },
    { key: 'appPassword', label: 'App password', type: 'password', help: 'Bluesky → Settings → Privacy and security → App passwords. Never use your main password.' },
    { key: 'service', label: 'PDS host (optional)', placeholder: 'https://bsky.social' },
  ],
  async verify(c) {
    const s = await session(c);
    c.did = s.did;
    const p = await json(`${PUBLIC}/app.bsky.actor.getProfile?actor=${encodeURIComponent(s.did)}`);
    return { name: p.displayName || p.handle, handle: '@' + p.handle, avatar: p.avatar || null };
  },
  async publish(c, post) {
    const s = await session(c);
    const record = { $type: 'app.bsky.feed.post', text: post.text, createdAt: new Date().toISOString(), langs: ['en'] };
    const f = facets(post.text);
    if (f.length) record.facets = f;
    const images = post.media.filter(isImage).slice(0, 4);
    const video = post.media.find(isVideo);
    const upload = async m => (await request(`${host(c)}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST', headers: { Authorization: `Bearer ${s.accessJwt}`, 'Content-Type': m.mime },
      body: fs.readFileSync(m.path),
    })).data.blob;
    if (images.length) {
      const imgs = [];
      for (const m of images) {
        if (m.size > 1_000_000) throw new Error(`Bluesky images must be under 1 MB (${m.original_name} is ${(m.size / 1e6).toFixed(1)} MB)`);
        imgs.push({ alt: '', image: await upload(m) });
      }
      record.embed = { $type: 'app.bsky.embed.images', images: imgs };
    } else if (video) {
      record.embed = { $type: 'app.bsky.embed.video', video: await upload(video) };
    }
    const r = await json(`${host(c)}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST', headers: { Authorization: `Bearer ${s.accessJwt}` },
      body: { repo: s.did, collection: 'app.bsky.feed.post', record },
    });
    const rkey = r.uri.split('/').pop();
    return { remoteId: r.uri, url: `https://bsky.app/profile/${s.handle}/post/${rkey}` };
  },
  async stats(c) {
    const p = await json(`${PUBLIC}/app.bsky.actor.getProfile?actor=${encodeURIComponent(c.did || c.handle)}`);
    return { followers: p.followersCount, following: p.followsCount, posts: p.postsCount };
  },
  async metrics(c, remoteId) {
    const r = await json(`${PUBLIC}/app.bsky.feed.getPosts?uris=${encodeURIComponent(remoteId)}`);
    const p = r.posts?.[0];
    if (!p) return null;
    return { likes: p.likeCount, comments: p.replyCount, shares: (p.repostCount || 0) + (p.quoteCount || 0) };
  },
};
