# Socialdesk

**Free, open-source social media management for companies, agencies and creators.**
Connect every profile once, schedule posts to all of them at the same time, and track what works. Self-hosted: no subscriptions, no seat limits, no brand limits. MIT licensed.

- **Post everywhere at once:** Facebook Pages, Instagram, Threads, X, LinkedIn (profiles and company pages), TikTok, YouTube, Pinterest, Bluesky, Mastodon, Telegram, Discord. Snapchat and any other network work in reminder mode.
- **One-click login:** "Continue with Facebook / X / LinkedIn / TikTok / YouTube / Pinterest / Threads / Mastodon" buttons. Tokens refresh automatically.
- **Multi-company:** anyone can sign up and get their own private workspace. Inside a workspace you get unlimited brands (one per client or product) and unlimited teammates.
- **Planner:** month, week and list views, with drag-and-drop rescheduling, drafts, queue and history.
- **Composer:** custom text per network, live previews, character counters, a media library and a "Select all accounts" button.
- **Analytics:** follower growth, engagement per post and per network, a best-time-to-post heatmap, CSV export and printable reports.
- **Link in bio:** a public landing page with your links and your latest posts.
- **Zero dependencies:** plain Node.js (22.13+) with its built-in SQLite. No build step.

## Quick start

```bash
node --env-file-if-exists=.env server.js
```
On Windows you can also double-click `start.cmd`. Then open http://localhost:3000.

The first account you create becomes the **server administrator**. Everyone who signs up after that gets their own separate workspace.

### Docker
```bash
docker compose up -d
```
Data is kept in the `socialdesk-data` volume.

## Put it on the internet (needed for login buttons)

The login providers send users back to your server, and most of them require **https**. Pick one of these options:

| Option | Cost | How |
|---|---|---|
| Your own PC + Cloudflare Tunnel | free | Run `cloudflared tunnel --url http://localhost:3000`. For a permanent address, use a named tunnel on your own domain. |
| Oracle Cloud "Always Free" VM | free | Install Docker, run `docker compose up -d`, then put Caddy in front for automatic https. |
| Any VPS / Fly.io / Railway with a persistent volume | low / free tier | Deploy the Dockerfile and mount a volume at `/data`. |

Then set `PUBLIC_URL=https://your-address` in `.env`, or set it in **Server admin → Public URL**.

> Hosts that wipe the disk on every restart (for example Render's free tier) will lose your database. Always use a persistent volume.

## Turn on the login buttons (one-time setup by the server admin)

Each network only gives API access to apps that you register yourself. Registration is free, but it's a rule of each platform, so nobody can skip it for you. Open **Server admin → Integrations**. It shows the exact Redirect URI to copy and step-by-step instructions for each one:

| Provider | Developer portal | Notes |
|---|---|---|
| Facebook & Instagram | developers.facebook.com | One login adds all selected Pages and their Instagram accounts. **App Review** is required before customers outside your app's roles can connect. |
| Threads | developers.facebook.com (Threads API use case) | Uses a separate Threads App ID and secret. |
| LinkedIn | linkedin.com/developers | "Share on LinkedIn" and "Sign In with OpenID" are approved instantly. Company pages need "Community Management API" plus `LINKEDIN_ORG_SCOPES=1`. |
| X | developer.x.com | The Free tier works, but it has a low monthly post limit. |
| TikTok | developers.tiktok.com | Posts are private until TikTok audits your app. |
| YouTube | console.cloud.google.com | Uploads stay private until Google verifies the app. |
| Pinterest | developers.pinterest.com | Trial access only posts to the sandbox (`PINTEREST_SANDBOX=1`). Request Standard access to post publicly. |
| Mastodon | (none) | Works automatically on any server. |
| Bluesky, Telegram, Discord | (none) | Paste an app password, bot token or webhook URL. |

Keys can also be supplied as environment variables. See [.env.example](.env.example).

You can also skip the login buttons entirely: every network has a **"Paste a token instead"** option.

## Configuration

All settings are optional environment variables, listed in [.env.example](.env.example):
- `PORT`, `PUBLIC_URL`, `DATA_DIR`
- `SECRET_KEY`: encrypts stored tokens. Keep it, or keep `data/secret.key`.
- `ALLOW_SIGNUP=0`: makes the install private to your company.
- `MAX_UPLOAD_MB`
- `*_CLIENT_ID` / `*_CLIENT_SECRET`: OAuth app keys.

**Back up the `data/` folder.** It holds the database, uploads and the encryption key.

## Security
- Each workspace is fully isolated. Every API call is checked against the caller's workspace, and the automated tests cover this.
- Passwords are hashed with scrypt.
- Network tokens are encrypted with AES-256-GCM.
- Cookies are HttpOnly, SameSite and Secure on https.
- Cross-site writes are blocked, and login and sign-up are rate-limited.
- Uploaded media gets random 128-bit file names.

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).

## Development
```
server.js            HTTP server, REST API, OAuth routes, link-in-bio pages
src/db.js            SQLite schema + migrations, settings, encryption
src/apps.js          OAuth app registry (setup steps per provider)
src/oauth.js         "Continue with…" flows and token refresh
src/scheduler.js     publishing loop, retries, analytics collection
src/networks/*.js    one adapter per network: verify / publish / stats / metrics
public/              the web app (vanilla JS, no build step)
tests/               end-to-end API tests  →  npm test
```
To add a network, copy an adapter in `src/networks/`, register it in `src/networks/index.js`, and send a pull request. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License
MIT. Free for personal and commercial use.
