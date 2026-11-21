'use strict';
// Facebook Pages + Instagram (professional accounts) via the Meta Graph API.
const { json, fileBlob, sleep, isVideo, isImage, requirePublicUrl } = require('./util');

const G = c => `https://graph.facebook.com/${c.apiVersion || 'v23.0'}`;

const facebook = {
  id: 'facebook', label: 'Facebook Page', color: '#0866ff',
  limits: { text: 63206, images: 10, video: true },
  fields: [
    { key: 'pageId', label: 'Page ID' },
    { key: 'token', label: 'Page access token', type: 'password', help: 'From Graph API Explorer with pages_manage_posts, pages_read_engagement, read_insights. Exchange for a long-lived token — page tokens derived from a long-lived user token do not expire.' },
    { key: 'apiVersion', label: 'Graph API version (optional)', placeholder: 'v23.0' },
  ],
  async verify(c) {
    const p = await json(`${G(c)}/${c.pageId}?fields=name,username,picture{url}&access_token=${encodeURIComponent(c.token)}`);
    return { name: p.name, handle: p.username ? '@' + p.username : p.id, avatar: p.picture?.data?.url || null };
  },
  async publish(c, post) {
    const tok = c.token;
    const imgs = post.media.filter(isImage);
    const video = post.media.find(isVideo);
    let id;
    if (video) {
      const fd = new FormData();
      fd.append('access_token', tok);
      fd.append('description', post.text);
      fd.append('source', fileBlob(video), video.original_name);
      id = (await json(`${G(c)}/${c.pageId}/videos`, { method: 'POST', body: fd })).id;
    } else if (imgs.length === 1) {
      const fd = new FormData();
      fd.append('access_token', tok);
      fd.append('caption', post.text);
      fd.append('source', fileBlob(imgs[0]), imgs[0].original_name);
      const r = await json(`${G(c)}/${c.pageId}/photos`, { method: 'POST', body: fd });
      id = r.post_id || r.id;
    } else if (imgs.length > 1) {
      const attached = [];
      for (const m of imgs.slice(0, 10)) {
        const fd = new FormData();
        fd.append('access_token', tok);
        fd.append('published', 'false');
        fd.append('source', fileBlob(m), m.original_name);
        attached.push({ media_fbid: (await json(`${G(c)}/${c.pageId}/photos`, { method: 'POST', body: fd })).id });
      }
      id = (await json(`${G(c)}/${c.pageId}/feed`, { method: 'POST', body: { message: post.text, attached_media: attached, access_token: tok } })).id;
    } else {
      id = (await json(`${G(c)}/${c.pageId}/feed`, { method: 'POST', body: { message: post.text, access_token: tok } })).id;
    }
    return { remoteId: id, url: `https://www.facebook.com/${id}` };
  },
  async stats(c) {
    const p = await json(`${G(c)}/${c.pageId}?fields=followers_count,fan_count&access_token=${encodeURIComponent(c.token)}`);
    return { followers: p.followers_count ?? p.fan_count };
  },
  async metrics(c, id) {
    const p = await json(`${G(c)}/${id}?fields=reactions.summary(true).limit(0),comments.summary(true).limit(0),shares&access_token=${encodeURIComponent(c.token)}`);
    return { likes: p.reactions?.summary?.total_count, comments: p.comments?.summary?.total_count, shares: p.shares?.count || 0 };
  },
};

async function waitContainer(c, id) {
  for (let i = 0; i < 90; i++) {
    const s = await json(`${G(c)}/${id}?fields=status_code,status&access_token=${encodeURIComponent(c.token)}`);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error('Instagram media processing failed: ' + (s.status || s.status_code));
    await sleep(4000);
  }
  throw new Error('Instagram media processing timed out');
}

const instagram = {
  id: 'instagram', label: 'Instagram', color: '#e1306c',
  limits: { text: 2200, images: 10, video: true, mediaRequired: true },
  fields: [
    { key: 'igUserId', label: 'Instagram business account ID', help: 'GET /me/accounts?fields=instagram_business_account in Graph API Explorer.' },
    { key: 'token', label: 'Access token', type: 'password', help: 'Long-lived token with instagram_basic, instagram_content_publish, pages_read_engagement.' },
    { key: 'apiVersion', label: 'Graph API version (optional)', placeholder: 'v23.0' },
  ],
  async verify(c) {
    const p = await json(`${G(c)}/${c.igUserId}?fields=username,name,profile_picture_url&access_token=${encodeURIComponent(c.token)}`);
    return { name: p.name || p.username, handle: '@' + p.username, avatar: p.profile_picture_url || null };
  },
  async publish(c, post) {
    if (!post.media.length) throw new Error('Instagram posts need at least one image or video.');
    requirePublicUrl(post.media, 'Instagram');
    const tok = c.token;
    const create = body => json(`${G(c)}/${c.igUserId}/media`, { method: 'POST', body: { ...body, access_token: tok } });
    const item = (m, extra = {}) => isVideo(m)
      ? { media_type: extra.is_carousel_item ? 'VIDEO' : 'REELS', video_url: m.url, ...extra }
      : { image_url: m.url, ...extra };
    let creationId;
    if (post.media.length === 1) {
      creationId = (await create({ ...item(post.media[0]), caption: post.text })).id;
      if (isVideo(post.media[0])) await waitContainer(c, creationId);
    } else {
      const children = [];
      for (const m of post.media.slice(0, 10)) {
        const id = (await create(item(m, { is_carousel_item: true }))).id;
        if (isVideo(m)) await waitContainer(c, id);
        children.push(id);
      }
      creationId = (await create({ media_type: 'CAROUSEL', children: children.join(','), caption: post.text })).id;
      await waitContainer(c, creationId);
    }
    const pub = await json(`${G(c)}/${c.igUserId}/media_publish`, { method: 'POST', body: { creation_id: creationId, access_token: tok } });
    let url = null;
    try { url = (await json(`${G(c)}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(tok)}`)).permalink; } catch { }
    return { remoteId: pub.id, url };
  },
  async stats(c) {
    const p = await json(`${G(c)}/${c.igUserId}?fields=followers_count,follows_count,media_count&access_token=${encodeURIComponent(c.token)}`);
    return { followers: p.followers_count, following: p.follows_count, posts: p.media_count };
  },
  async metrics(c, id) {
    const p = await json(`${G(c)}/${id}?fields=like_count,comments_count&access_token=${encodeURIComponent(c.token)}`);
    return { likes: p.like_count, comments: p.comments_count };
  },
};

module.exports = { facebook, instagram };
