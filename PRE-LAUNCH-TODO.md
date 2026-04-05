# Pre-Launch TODO

Everything below MUST be done before pointing real users at the site.
Most are 5-minute fixes. Grouped by priority.

---

## 1. Replace the placeholder domain (2 min, must do)

Every file uses `randomchat.example` as a placeholder. Search-and-replace it
with your real domain across the whole project.

**Files that contain it:**
- `public/index.html` — canonical, og:url, og:image, twitter:image, JSON-LD
- `public/sitemap.xml` — all `<loc>` entries
- `public/robots.txt` — `Sitemap:` line
- `public/legal/terms.html` — canonical
- `public/legal/privacy.html` — canonical

Shell command (from project root):
```bash
grep -rl "randomchat.example" public/ | xargs sed -i 's/randomchat.example/yourdomain.com/g'
```

## 2. Set a real admin password (1 min, must do)

The server falls back to `changeme` if `ADMIN_PASSWORD` is unset and logs a
warning. On Railway/Render, set the env var in the dashboard:

```
ADMIN_PASSWORD=<something long and random>
```

Generate one: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`

## 3. Add missing image files (10 min, should do)

Referenced in `public/index.html` but not yet created:

| File | Size | Purpose |
|------|------|---------|
| `public/og.png` | 1200 × 630 | Social media preview card (Twitter, FB, Discord, Slack) |
| `public/favicon.ico` | 32 × 32 | Browser tab icon (legacy fallback) |
| `public/apple-touch-icon.png` | 180 × 180 | iOS home-screen icon |

Quick path: use [favicon.io](https://favicon.io) — upload `public/favicon.svg`,
it outputs the full set. For og.png, use [og-image.vercel.app](https://og-image.vercel.app)
or design a 1200x630 PNG in Canva.

If you skip this: browsers will 404 on favicon.ico (harmless, just log noise),
but social shares will look broken without og.png.

## 4. Add a TURN server (15 min, critical before real traffic)

STUN-only (what's configured now) fails for ~30% of users behind strict NAT
(corporate networks, some mobile carriers). You need TURN for real reliability.

**Options:**
- **Metered.ca** — free tier, 50GB/mo, easy signup. Recommended for launch.
- **Twilio Network Traversal** — $0.40/GB, pay-as-you-go.
- **Self-host Coturn** on a $5 VPS.

Once you have credentials, edit `public/app.js`:

```js
const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:your.turn.server:3478",
      username: "YOUR_USERNAME",
      credential: "YOUR_PASSWORD"
    }
  ],
};
```

## 5. Deploy (10 min)

```bash
# From project root:
git init
git add .
git commit -m "Initial commit"

# Push to a new GitHub repo, then:
# 1. Go to railway.app → New Project → Deploy from GitHub repo
# 2. Add env vars: PORT (auto), ADMIN_PASSWORD
# 3. Add a persistent volume mounted at /app/data  (so SQLite survives restarts)
# 4. Add your custom domain under Settings → Domains
```

Note: **Railway's free tier does not include persistent volumes.** Without one,
your SQLite DB is wiped on every redeploy — reports and bans are lost.
Either upgrade to Hobby ($5/mo) for volumes, or switch to Postgres
(Railway provides a free Postgres add-on).

## 6. Verify in production (5 min)

After deploy:
- [ ] Open your URL on laptop AND phone (different networks) — pair successfully
- [ ] Age gate shows, works, persists after refresh
- [ ] Try reporting someone — verify it shows in `/admin`
- [ ] Visit `/admin` — auth prompt appears, wrong password fails, right one works
- [ ] Test banned flow: ban your own IP via admin, reload home → redirects to banned page

---

## Nice-to-haves (after launch)

- **Analytics**: add [Plausible](https://plausible.io) ($9/mo) or self-host [Umami](https://umami.is)
- **Error tracking**: [Sentry](https://sentry.io) free tier
- **CSP headers** in server.js to lock down XSS surface
- **Rate limit admin login attempts** (currently no brute-force protection)
- **Database backups**: daily dump of `data/randomchat.db` to S3 or similar
