'use strict';
// Developer-app credentials ("OAuth apps") for one-click Connect buttons.
// Each can come from environment variables or be entered by the platform admin in Settings → Integrations.
const { getSetting, setSetting, encrypt, decrypt } = require('./db');

const PROVIDERS = {
  meta: {
    label: 'Facebook & Instagram', env: 'META', networks: ['facebook', 'instagram'],
    portal: 'https://developers.facebook.com/apps',
    steps: [
      'Create an app → type "Business" (or use case "Manage everything on your Page" + "Manage messaging & content on Instagram").',
      'Add the product "Facebook Login for Business" and paste the Redirect URI below into "Valid OAuth Redirect URIs".',
      'Copy App ID and App Secret from App settings → Basic.',
      'While the app is in Development mode only people with a role on the app can connect. Submit for App Review (pages_manage_posts, instagram_content_publish…) to let any customer connect.',
    ],
  },
  threads: {
    label: 'Threads', env: 'THREADS', networks: ['threads'],
    portal: 'https://developers.facebook.com/apps',
    steps: [
      'Create a Meta app with the use case "Access the Threads API".',
      'In Threads API → Settings, paste the Redirect URI below into "Redirect Callback URLs".',
      'Copy the Threads App ID and Threads App Secret (different from the main App ID).',
      'Add testers under App roles until the app is approved through App Review.',
    ],
  },
  linkedin: {
    label: 'LinkedIn', env: 'LINKEDIN', networks: ['linkedin'],
    portal: 'https://www.linkedin.com/developers/apps',
    steps: [
      'Create an app (needs a LinkedIn company page to attach it to).',
      'Products tab: request "Share on LinkedIn" and "Sign In with LinkedIn using OpenID Connect" (both approved instantly). Optional: "Community Management API" for posting as company pages.',
      'Auth tab: add the Redirect URI below, copy Client ID and Client Secret.',
    ],
  },
  x: {
    label: 'X (Twitter)', env: 'X', networks: ['x'],
    portal: 'https://developer.x.com/en/portal/dashboard',
    steps: [
      'Sign up for a developer account (Free tier works, with low monthly post limits).',
      'Project → App → User authentication settings: App permissions "Read and write", Type "Web App", Callback URI = Redirect URI below.',
      'Keys and tokens → OAuth 2.0 Client ID and Client Secret.',
    ],
  },
  tiktok: {
    label: 'TikTok', env: 'TIKTOK', networks: ['tiktok'],
    portal: 'https://developers.tiktok.com/apps',
    steps: [
      'Create an app, add products "Login Kit" and "Content Posting API" (enable Direct Post).',
      'Scopes: user.info.basic, user.info.stats, video.publish, video.list.',
      'Login Kit → Redirect URI: paste the Redirect URI below (must be https).',
      'Copy Client key and Client secret. Until TikTok audits the app, posts are private (SELF_ONLY) — TikTok\'s rule.',
    ],
  },
  pinterest: {
    label: 'Pinterest', env: 'PINTEREST', networks: ['pinterest'],
    portal: 'https://developers.pinterest.com/apps/',
    steps: [
      'Connect a Pinterest business account and create an app.',
      'Add the Redirect URI below, copy App ID and App secret key.',
      'New apps get "Trial access" (pins go to the sandbox). Request Standard access to post publicly.',
    ],
  },
  google: {
    label: 'YouTube', env: 'GOOGLE', networks: ['youtube'],
    portal: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'Create a Google Cloud project and enable "YouTube Data API v3".',
      'OAuth consent screen: External; add scopes youtube.upload and youtube.readonly; add test users while in Testing.',
      'Credentials → Create OAuth client ID → Web application → Authorized redirect URI = Redirect URI below.',
      'Videos uploaded by unverified apps are locked to private until Google verifies the app — Google\'s rule.',
    ],
  },
};

function get(provider) {
  const p = PROVIDERS[provider];
  if (!p) return null;
  const envId = process.env[`${p.env}_CLIENT_ID`], envSecret = process.env[`${p.env}_CLIENT_SECRET`];
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, source: 'env' };
  const raw = getSetting('oauth:' + provider);
  if (!raw) return null;
  try { const v = decrypt(raw); return v.clientId && v.clientSecret ? { ...v, source: 'settings' } : null; } catch { return null; }
}
function set(provider, clientId, clientSecret) {
  if (!clientId && !clientSecret) return setSetting('oauth:' + provider, '');
  const prev = get(provider) || {};
  setSetting('oauth:' + provider, encrypt({ clientId: clientId || prev.clientId, clientSecret: clientSecret || prev.clientSecret }));
}
const providerForNetwork = net => Object.keys(PROVIDERS).find(k => PROVIDERS[k].networks.includes(net)) || (net === 'mastodon' ? 'mastodon' : null);

module.exports = { PROVIDERS, get, set, providerForNetwork };
