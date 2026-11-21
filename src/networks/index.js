'use strict';
const { facebook, instagram } = require('./meta');
const { snapchat, reminder } = require('./manual');
const apps = require('../apps');

const list = [
  facebook, instagram, require('./threads'), require('./x'), require('./linkedin'), require('./tiktok'),
  require('./youtube'), require('./pinterest'), require('./bluesky'), require('./mastodon'),
  require('./telegram'), require('./discord'), snapchat, reminder,
];
const networks = Object.fromEntries(list.map(n => [n.id, n]));

function publicInfo() {
  return list.map(n => {
    const provider = apps.providerForNetwork(n.id);
    return {
      id: n.id, label: n.label, color: n.color, limits: n.limits, fields: n.fields, manual: !!n.manual, hasStats: !!n.stats,
      oauth: provider ? { provider, configured: provider === 'mastodon' || !!apps.get(provider), label: provider === 'mastodon' ? 'Mastodon' : apps.PROVIDERS[provider].label } : null,
    };
  });
}

module.exports = { networks, publicInfo };
