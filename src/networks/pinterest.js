'use strict';
const fs = require('node:fs');
const { json, isImage } = require('./util');

const API = () => process.env.PINTEREST_SANDBOX === '1' ? 'https://api-sandbox.pinterest.com/v5' : 'https://api.pinterest.com/v5';

async function H(c) {
  const o = require('../oauth');
  if (c.refreshToken && o.soon(c)) await o.refreshPinterest(c);
  return { Authorization: `Bearer ${c.accessToken}` };
}

module.exports = {
  id: 'pinterest', label: 'Pinterest', color: '#e60023',
  limits: { text: 500, images: 5, video: false, mediaRequired: true },
  fields: [
    { key: 'accessToken', label: 'Access token', type: 'password', help: 'Easier: use the "Continue with Pinterest" button.' },
    { key: 'boardId', label: 'Board ID' },
    { key: 'link', label: 'Destination link for pins (optional)', placeholder: 'https://yourshop.com' },
  ],
  async verify(c) {
    const me = await json(`${API()}/user_account`, { headers: await H(c) });
    let board = '';
    if (c.boardId) { try { board = ' · ' + (await json(`${API()}/boards/${c.boardId}`, { headers: await H(c) })).name; } catch { } }
    return { name: me.username + board, handle: '@' + me.username, avatar: me.profile_image || null };
  },
  async publish(c, post) {
    const imgs = post.media.filter(isImage).slice(0, 5);
    if (!imgs.length) throw new Error('Pinterest pins need an image.');
    const [first, ...rest] = post.text.split('\n');
    const src = imgs.length === 1
      ? { source_type: 'image_base64', content_type: imgs[0].mime, data: fs.readFileSync(imgs[0].path).toString('base64') }
      : { source_type: 'multiple_image_base64', items: imgs.map(m => ({ content_type: m.mime, data: fs.readFileSync(m.path).toString('base64') })) };
    const link = c.link || (post.text.match(/https?:\/\/\S+/) || [])[0];
    const pin = await json(`${API()}/pins`, {
      method: 'POST', headers: await H(c),
      body: { board_id: c.boardId, title: first.slice(0, 100), description: (rest.join('\n') || post.text).slice(0, 500), ...(link ? { link } : {}), media_source: src },
    });
    return { remoteId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
  },
  async stats(c) {
    const me = await json(`${API()}/user_account`, { headers: await H(c) });
    return { followers: me.follower_count, following: me.following_count, posts: me.pin_count };
  },
};
