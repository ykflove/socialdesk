'use strict';
const fs = require('node:fs');
const { json, request, isVideo, isImage, requirePublicUrl, sleep } = require('./util');

const API = 'https://open.tiktokapis.com/v2';

async function token(c) {
  // Refresh the 24h access token (uses the server's TikTok app keys, or keys pasted on the account)
  if (c.refreshToken && (!c.expiresAt || Date.now() > c.expiresAt - 5 * 60_000)) await require('../oauth').refreshTikTok(c);
  return { Authorization: `Bearer ${c.accessToken}` };
}

function check(r) {
  if (r.error && r.error.code && r.error.code !== 'ok') throw new Error(`TikTok: ${r.error.code} ${r.error.message || ''}`);
  return r.data;
}

async function waitPublish(c, publishId) {
  for (let i = 0; i < 60; i++) {
    const d = check(await json(`${API}/post/publish/status/fetch/`, { method: 'POST', headers: await token(c), body: { publish_id: publishId } }));
    if (d.status === 'PUBLISH_COMPLETE') return d;
    if (d.status === 'FAILED') throw new Error('TikTok publish failed: ' + (d.fail_reason || 'unknown'));
    if (d.status === 'SEND_TO_USER_INBOX') return d;
    await sleep(5000);
  }
  return {};
}

module.exports = {
  id: 'tiktok', label: 'TikTok', color: '#000000',
  limits: { text: 2200, images: 35, video: true, mediaRequired: true },
  fields: [
    { key: 'accessToken', label: 'User access token', type: 'password', help: 'OAuth token for your TikTok developer app with scopes user.info.basic, user.info.stats, video.publish.' },
    { key: 'refreshToken', label: 'Refresh token (recommended)', type: 'password', help: 'Lets Socialdesk renew the 24-hour access token automatically.' },
    { key: 'clientKey', label: 'Client key (for refresh)' },
    { key: 'clientSecret', label: 'Client secret (for refresh)', type: 'password' },
    { key: 'privacy', label: 'Privacy level', placeholder: 'SELF_ONLY', help: 'Unaudited apps may only post SELF_ONLY (private). After TikTok audits your app use PUBLIC_TO_EVERYONE.' },
  ],
  async verify(c) {
    const d = check(await json(`${API}/user/info/?fields=open_id,display_name,avatar_url,username`, { headers: await token(c) }));
    const u = d.user;
    return { name: u.display_name, handle: u.username ? '@' + u.username : u.open_id, avatar: u.avatar_url || null };
  },
  async publish(c, post) {
    const privacy = c.privacy || 'SELF_ONLY';
    const video = post.media.find(isVideo);
    if (video) {
      const size = video.size;
      const CH = 10 * 1024 * 1024;
      const chunk = size <= 64 * 1024 * 1024 ? size : CH;
      const count = Math.floor(size / chunk) || 1;
      const init = check(await json(`${API}/post/publish/video/init/`, {
        method: 'POST', headers: await token(c),
        body: {
          post_info: { title: post.text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false },
          source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunk, total_chunk_count: count },
        },
      }));
      const buf = fs.readFileSync(video.path);
      for (let i = 0; i < count; i++) {
        const start = i * chunk;
        const end = i === count - 1 ? size : start + chunk; // last chunk absorbs remainder
        await request(init.upload_url, {
          method: 'PUT', body: buf.subarray(start, end),
          headers: { 'Content-Type': video.mime, 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
        });
      }
      const st = await waitPublish(c, init.publish_id);
      const vid = st.publicaly_available_post_id?.[0] || st.publicly_available_post_id?.[0];
      return { remoteId: vid ? String(vid) : init.publish_id, url: null };
    }
    const imgs = post.media.filter(isImage);
    if (!imgs.length) throw new Error('TikTok needs a video or photos.');
    requirePublicUrl(imgs, 'TikTok photo mode');
    const init = check(await json(`${API}/post/publish/content/init/`, {
      method: 'POST', headers: await token(c),
      body: {
        post_info: { title: post.text.slice(0, 90), description: post.text, privacy_level: privacy },
        source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: imgs.map(m => m.url) },
        post_mode: 'DIRECT_POST', media_type: 'PHOTO',
      },
    }));
    await waitPublish(c, init.publish_id);
    return { remoteId: init.publish_id, url: null };
  },
  async stats(c) {
    const d = check(await json(`${API}/user/info/?fields=follower_count,following_count,video_count,likes_count`, { headers: await token(c) }));
    return { followers: d.user.follower_count, following: d.user.following_count, posts: d.user.video_count };
  },
  async metrics(c, id) {
    if (!/^\d+$/.test(id)) return null;
    const d = check(await json(`${API}/video/query/?fields=id,like_count,comment_count,share_count,view_count`, {
      method: 'POST', headers: await token(c), body: { filters: { video_ids: [id] } },
    }));
    const v = d.videos?.[0];
    return v ? { likes: v.like_count, comments: v.comment_count, shares: v.share_count, views: v.view_count } : null;
  },
};
