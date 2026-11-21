'use strict';
const fs = require('node:fs');
const { json, request, isVideo } = require('./util');

async function H(c) {
  const o = require('../oauth');
  if (c.refreshToken && o.soon(c)) await o.refreshGoogle(c);
  return { Authorization: `Bearer ${c.accessToken}` };
}

module.exports = {
  id: 'youtube', label: 'YouTube', color: '#ff0000',
  limits: { text: 5000, images: 0, video: true, mediaRequired: true },
  fields: [
    { key: 'accessToken', label: 'Access token', type: 'password', help: 'Use the "Continue with YouTube" button — Google tokens expire hourly and need the refresh flow.' },
    { key: 'privacy', label: 'Privacy', placeholder: 'public | unlisted | private' },
  ],
  async verify(c) {
    const ch = await json('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: await H(c) });
    const s = ch.items?.[0];
    if (!s) throw new Error('No YouTube channel on this account');
    c.channelId = s.id;
    return { name: s.snippet.title, handle: s.snippet.customUrl || s.id, avatar: s.snippet.thumbnails?.default?.url || null };
  },
  // First line = title (max 100 chars), whole text = description. Vertical videos under 3 min become Shorts automatically.
  async publish(c, post) {
    const v = post.media.find(isVideo);
    if (!v) throw new Error('YouTube needs a video.');
    const title = (post.text.split('\n')[0] || v.original_name).replace(/[<>]/g, '').slice(0, 100) || 'Video';
    const init = await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: { ...(await H(c)), 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': v.mime, 'X-Upload-Content-Length': String(v.size) },
      body: JSON.stringify({
        snippet: { title, description: post.text.replace(/[<>]/g, '').slice(0, 5000), categoryId: '22' },
        status: { privacyStatus: ['public', 'unlisted', 'private'].includes(c.privacy) ? c.privacy : 'public', selfDeclaredMadeForKids: false },
      }),
    });
    const up = await request(init.headers.get('location'), { method: 'PUT', headers: { 'Content-Type': v.mime }, body: fs.readFileSync(v.path) });
    return { remoteId: up.data.id, url: `https://www.youtube.com/watch?v=${up.data.id}` };
  },
  async stats(c) {
    const ch = await json('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', { headers: await H(c) });
    const s = ch.items?.[0]?.statistics || {};
    return { followers: Number(s.subscriberCount ?? 0), posts: Number(s.videoCount ?? 0) };
  },
  async metrics(c, id) {
    const r = await json(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${id}`, { headers: await H(c) });
    const s = r.items?.[0]?.statistics;
    return s ? { likes: Number(s.likeCount || 0), comments: Number(s.commentCount || 0), views: Number(s.viewCount || 0) } : null;
  },
};
