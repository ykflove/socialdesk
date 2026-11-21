'use strict';
const { json, fileBlob, isVideo } = require('./util');

const api = (c, method) => `https://api.telegram.org/bot${c.botToken}/${method}`;

module.exports = {
  id: 'telegram', label: 'Telegram', color: '#26a5e4',
  limits: { text: 4096, captionWithMedia: 1024, images: 10, video: true },
  fields: [
    { key: 'botToken', label: 'Bot token', type: 'password', help: 'Create a bot with @BotFather, then add the bot as an admin of your channel/group.' },
    { key: 'chatId', label: 'Channel or chat', placeholder: '@mychannel or -100123456789' },
  ],
  async verify(c) {
    const { result: chat } = await json(api(c, 'getChat') + '?chat_id=' + encodeURIComponent(c.chatId));
    return { name: chat.title || chat.username || String(chat.id), handle: chat.username ? '@' + chat.username : String(chat.id), avatar: null };
  },
  async publish(c, post) {
    const media = post.media.slice(0, 10);
    let msg;
    if (!media.length) {
      msg = (await json(api(c, 'sendMessage'), { method: 'POST', body: { chat_id: c.chatId, text: post.text } })).result;
    } else if (media.length === 1) {
      const m = media[0];
      const field = isVideo(m) ? 'video' : 'photo';
      const fd = new FormData();
      fd.append('chat_id', c.chatId);
      fd.append('caption', post.text.slice(0, 1024));
      fd.append(field, fileBlob(m), m.original_name);
      msg = (await json(api(c, isVideo(m) ? 'sendVideo' : 'sendPhoto'), { method: 'POST', body: fd })).result;
    } else {
      const fd = new FormData();
      fd.append('chat_id', c.chatId);
      fd.append('media', JSON.stringify(media.map((m, i) => ({
        type: isVideo(m) ? 'video' : 'photo', media: `attach://f${i}`, ...(i === 0 ? { caption: post.text.slice(0, 1024) } : {}),
      }))));
      media.forEach((m, i) => fd.append(`f${i}`, fileBlob(m), m.original_name));
      msg = (await json(api(c, 'sendMediaGroup'), { method: 'POST', body: fd })).result[0];
    }
    const username = msg.chat?.username;
    return { remoteId: String(msg.message_id), url: username ? `https://t.me/${username}/${msg.message_id}` : null };
  },
  async stats(c) {
    const { result } = await json(api(c, 'getChatMemberCount') + '?chat_id=' + encodeURIComponent(c.chatId));
    return { followers: result };
  },
};
