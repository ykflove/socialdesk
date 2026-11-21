'use strict';
const { json, fileBlob, sleep } = require('./util');

const base = c => c.instance.replace(/\/$/, '').replace(/^(?!https?:\/\/)/, 'https://');
const auth = c => ({ Authorization: `Bearer ${c.token}` });

module.exports = {
  id: 'mastodon', label: 'Mastodon', color: '#6364ff',
  limits: { text: 500, images: 4, video: true },
  fields: [
    { key: 'instance', label: 'Instance URL', placeholder: 'https://mastodon.social' },
    { key: 'token', label: 'Access token', type: 'password', help: 'Preferences → Development → New application (scopes: read, write:statuses, write:media) → copy "Your access token".' },
  ],
  async verify(c) {
    const a = await json(`${base(c)}/api/v1/accounts/verify_credentials`, { headers: auth(c) });
    c.accountId = a.id;
    return { name: a.display_name || a.username, handle: '@' + a.acct + '@' + new URL(base(c)).host, avatar: a.avatar };
  },
  async publish(c, post) {
    const ids = [];
    for (const m of post.media.slice(0, 4)) {
      const fd = new FormData();
      fd.append('file', fileBlob(m), m.original_name);
      let media = await json(`${base(c)}/api/v2/media`, { method: 'POST', headers: auth(c), body: fd });
      for (let i = 0; i < 60 && !media.url; i++) { // processing (videos)
        await sleep(2000);
        media = await json(`${base(c)}/api/v1/media/${media.id}`, { headers: auth(c) });
      }
      ids.push(media.id);
    }
    const s = await json(`${base(c)}/api/v1/statuses`, {
      method: 'POST', headers: auth(c), body: { status: post.text, media_ids: ids, visibility: 'public' },
    });
    return { remoteId: s.id, url: s.url };
  },
  async stats(c) {
    const a = await json(`${base(c)}/api/v1/accounts/verify_credentials`, { headers: auth(c) });
    return { followers: a.followers_count, following: a.following_count, posts: a.statuses_count };
  },
  async metrics(c, id) {
    const s = await json(`${base(c)}/api/v1/statuses/${id}`, { headers: auth(c) });
    return { likes: s.favourites_count, comments: s.replies_count, shares: s.reblogs_count };
  },
};
