'use strict';
const { json, isVideo, sleep, requirePublicUrl } = require('./util');

const G = 'https://graph.threads.net/v1.0';
const q = o => new URLSearchParams(o);

async function fresh(c) {
  const o = require('../oauth');
  if (c.expiresAt && Date.now() > c.expiresAt - 7 * 86400_000) { try { await o.refreshThreads(c); } catch { } }
}
async function waitReady(c, id) {
  for (let i = 0; i < 60; i++) {
    const s = await json(`${G}/${id}?` + q({ fields: 'status,error_message', access_token: c.token }));
    if (s.status === 'FINISHED') return;
    if (s.status === 'ERROR' || s.status === 'EXPIRED') throw new Error('Threads media failed: ' + (s.error_message || s.status));
    await sleep(3000);
  }
}

module.exports = {
  id: 'threads', label: 'Threads', color: '#101010',
  limits: { text: 500, images: 20, video: true },
  fields: [
    { key: 'userId', label: 'Threads user ID' },
    { key: 'token', label: 'Access token', type: 'password', help: 'Easier: use the "Continue with Threads" button.' },
  ],
  async verify(c) {
    const me = await json(`${G}/me?` + q({ fields: 'id,username,name,threads_profile_picture_url', access_token: c.token }));
    c.userId = me.id;
    return { name: me.name || me.username, handle: '@' + me.username, avatar: me.threads_profile_picture_url || null };
  },
  async publish(c, post) {
    await fresh(c);
    const create = p => json(`${G}/${c.userId}/threads`, { method: 'POST', body: q({ ...p, access_token: c.token }) });
    const media = post.media.slice(0, 20);
    if (media.length) requirePublicUrl(media, 'Threads');
    const item = (m, extra = {}) => isVideo(m) ? { media_type: 'VIDEO', video_url: m.url, ...extra } : { media_type: 'IMAGE', image_url: m.url, ...extra };
    let id;
    if (!media.length) id = (await create({ media_type: 'TEXT', text: post.text })).id;
    else if (media.length === 1) { id = (await create({ ...item(media[0]), text: post.text })).id; await waitReady(c, id); }
    else {
      const kids = [];
      for (const m of media) { const k = (await create(item(m, { is_carousel_item: 'true' }))).id; await waitReady(c, k); kids.push(k); }
      id = (await create({ media_type: 'CAROUSEL', children: kids.join(','), text: post.text })).id;
      await waitReady(c, id);
    }
    const pub = await json(`${G}/${c.userId}/threads_publish`, { method: 'POST', body: q({ creation_id: id, access_token: c.token }) });
    let url = null;
    try { url = (await json(`${G}/${pub.id}?` + q({ fields: 'permalink', access_token: c.token }))).permalink; } catch { }
    return { remoteId: pub.id, url };
  },
  async stats(c) {
    await fresh(c);
    const r = await json(`${G}/${c.userId}/threads_insights?` + q({ metric: 'followers_count', access_token: c.token }));
    return { followers: r.data?.[0]?.total_value?.value };
  },
  async metrics(c, id) {
    const r = await json(`${G}/${id}/insights?` + q({ metric: 'views,likes,replies,reposts,quotes', access_token: c.token }));
    const v = Object.fromEntries((r.data || []).map(d => [d.name, d.values?.[0]?.value ?? d.total_value?.value ?? 0]));
    return { likes: v.likes, comments: v.replies, shares: (v.reposts || 0) + (v.quotes || 0), views: v.views };
  },
};
