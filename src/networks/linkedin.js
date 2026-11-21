'use strict';
const fs = require('node:fs');
const { json, request, isImage, isVideo, sleep } = require('./util');

const H = c => ({
  Authorization: `Bearer ${c.token}`,
  'LinkedIn-Version': c.version || '202604',
  'X-Restli-Protocol-Version': '2.0.0',
});

// LinkedIn "little text" format: reserved characters must be escaped.
const escape = t => t.replace(/[\\|{}@\[\]()<>#*_~]/g, ch => '\\' + ch);

async function uploadImage(c, m) {
  const init = await json('https://api.linkedin.com/rest/images?action=initializeUpload', {
    method: 'POST', headers: H(c), body: { initializeUploadRequest: { owner: c.author } },
  });
  await request(init.value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${c.token}` }, body: fs.readFileSync(m.path) });
  return init.value.image;
}

async function uploadVideo(c, m) {
  const init = await json('https://api.linkedin.com/rest/videos?action=initializeUpload', {
    method: 'POST', headers: H(c),
    body: { initializeUploadRequest: { owner: c.author, fileSizeBytes: m.size, uploadCaptions: false, uploadThumbnail: false } },
  });
  const buf = fs.readFileSync(m.path);
  const etags = [];
  for (const ins of init.value.uploadInstructions) {
    const r = await request(ins.uploadUrl, { method: 'PUT', body: buf.subarray(ins.firstByte, ins.lastByte + 1) });
    etags.push(r.headers.get('etag'));
  }
  await json('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
    method: 'POST', headers: H(c),
    body: { finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken || '', uploadedPartIds: etags } },
  });
  for (let i = 0; i < 60; i++) {
    const v = await json(`https://api.linkedin.com/rest/videos/${encodeURIComponent(init.value.video)}`, { headers: H(c) });
    if (v.status === 'AVAILABLE') break;
    if (v.status === 'PROCESSING_FAILED') throw new Error('LinkedIn video processing failed');
    await sleep(5000);
  }
  return init.value.video;
}

module.exports = {
  id: 'linkedin', label: 'LinkedIn', color: '#0a66c2',
  limits: { text: 3000, images: 9, video: true },
  fields: [
    { key: 'token', label: 'Access token', type: 'password', help: 'From your LinkedIn developer app (products: "Share on LinkedIn" + "Sign In with LinkedIn using OpenID Connect"; scope w_member_social, or w_organization_social for pages). Tokens last 60 days.' },
    { key: 'author', label: 'Author URN (optional for personal)', placeholder: 'urn:li:organization:123456', help: 'Leave empty to post as yourself. For a company page use urn:li:organization:<id>.' },
    { key: 'version', label: 'API version (optional)', placeholder: '202604' },
  ],
  async verify(c) {
    if (!c.author) {
      const me = await json('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${c.token}` } });
      c.author = `urn:li:person:${me.sub}`;
      return { name: me.name, handle: me.email || 'LinkedIn member', avatar: me.picture || null };
    }
    if (c.author.includes('organization')) {
      const id = c.author.split(':').pop();
      try {
        const o = await json(`https://api.linkedin.com/rest/organizations/${id}`, { headers: H(c) });
        return { name: o.localizedName, handle: o.vanityName ? '/company/' + o.vanityName : c.author, avatar: null };
      } catch { /* fall through */ }
    }
    return { name: c.author, handle: c.author, avatar: null };
  },
  async publish(c, post) {
    const body = {
      author: c.author, commentary: escape(post.text), visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    };
    const imgs = post.media.filter(isImage).slice(0, 9);
    const video = post.media.find(isVideo);
    if (video) body.content = { media: { id: await uploadVideo(c, video) } };
    else if (imgs.length === 1) body.content = { media: { id: await uploadImage(c, imgs[0]) } };
    else if (imgs.length > 1) {
      const ids = [];
      for (const m of imgs) ids.push({ id: await uploadImage(c, m) });
      body.content = { multiImage: { images: ids } };
    }
    const r = await request('https://api.linkedin.com/rest/posts', {
      method: 'POST', headers: { ...H(c), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const id = r.headers.get('x-restli-id');
    return { remoteId: id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
  },
  async stats(c) {
    if (!c.author?.includes('organization')) return null; // personal follower counts need partner access
    const r = await json(`https://api.linkedin.com/rest/networkSizes/${encodeURIComponent(c.author)}?edgeType=COMPANY_FOLLOWED_BY_MEMBER`, { headers: H(c) });
    return { followers: r.firstDegreeSize };
  },
};
