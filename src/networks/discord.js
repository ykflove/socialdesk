'use strict';
const { json, fileBlob } = require('./util');

module.exports = {
  id: 'discord', label: 'Discord', color: '#5865f2',
  limits: { text: 2000, images: 10, video: true },
  fields: [
    { key: 'webhookUrl', label: 'Webhook URL', type: 'password', help: 'Server Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.' },
    { key: 'username', label: 'Display name (optional)' },
  ],
  async verify(c) {
    const w = await json(c.webhookUrl);
    c.guildId = w.guild_id;
    return { name: w.name, handle: '#' + (w.channel_id || 'channel'), avatar: w.avatar ? `https://cdn.discordapp.com/avatars/${w.id}/${w.avatar}.png` : null };
  },
  async publish(c, post) {
    const fd = new FormData();
    fd.append('payload_json', JSON.stringify({ content: post.text, ...(c.username ? { username: c.username } : {}) }));
    post.media.slice(0, 10).forEach((m, i) => fd.append(`files[${i}]`, fileBlob(m), m.original_name));
    const msg = await json(c.webhookUrl + (c.webhookUrl.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', body: fd });
    return { remoteId: msg.id, url: (msg.guild_id || c.guildId) ? `https://discord.com/channels/${msg.guild_id || c.guildId}/${msg.channel_id}/${msg.id}` : null };
  },
};
