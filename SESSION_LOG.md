# Session Log

## 2026-04-05 — Initial build + Phase 2 safety layer

### What got built
- **Phase 1 MVP** (`server.js`, `public/*`): Express + Socket.io signaling, WebRTC
  peer connection, random matchmaking with optional interest tags, text chat
  with typing indicator, Next/Stop/Report controls, dark themed UI, mobile layout.
- **Phase 2 safety layer** (parallel agent build):
  - SQLite persistence using Node 22+ built-in `node:sqlite` (zero external deps):
    `reports`, `bans`, `sessions` tables (`lib/db.js`).
  - Auto-ban moderation: 3+ reports against an IP in 24h → 7-day ban (`lib/moderation.js`).
  - Per-socket 2000ms rate limit on `find`/`next` events (`lib/rate-limit.js`).
  - Ban enforcement on connect — banned clients get `banned` event + disconnect.
  - Admin dashboard at `/admin` with HTTP Basic Auth, report queue, ban list,
    unban action, 30s auto-refresh that pauses when tab is hidden.
  - Age-gate modal (self-injecting, focus-trapped, localStorage-persisted).
  - Legal pages: Terms of Service, Privacy Policy, Banned page.
  - Admin API endpoints: `GET/POST /api/admin/{reports,bans,unban,reports/clear}`.

### Tests
- Built `tests/e2e.mjs` — 40 tests covering pairing, signaling, messaging,
  typing, rate limit, admin auth, report→ban flow, banned-on-connect, static
  assets. All 40 pass.
- Run with `npm test` (requires server running on PORT=3100 with
  `ADMIN_PASSWORD=testpass123`).

### Security findings fixed
- **express.static served `/admin/*` before auth middleware** — static files
  under `public/admin/` were accessible without credentials. Fixed by mounting
  `app.use("/admin", basicAuth)` BEFORE static middleware.
- **`banned` event dropped by Socket.io middleware rejection** — emitting
  before `next(new Error())` lost the event. Fixed by allowing connection and
  doing ban check + disconnect inside the `connection` handler with a 50ms
  delay to flush the emit.

### Simplify pass findings fixed
- Rate limiter cleanup was O(n) on every event — now lazy, only sweeps when
  map exceeds 256 entries.
- `broadcastStats` fired on every state change — now 250ms debounced,
  coalesces bursts.
- Admin dashboard polled every 30s even when tab hidden — now listens for
  `visibilitychange` and pauses.
- Report handler wrote null `target_ip` when reporter wasn't paired — now
  early-returns.

### SEO pass applied
- Added Open Graph + Twitter Card meta tags, canonical, JSON-LD structured
  data (WebApplication schema), keywords, expanded description.
- Created `robots.txt` (disallows /admin, /api, /socket.io, banned page).
- Created `sitemap.xml` with home + 2 legal pages.
- Added favicon.svg (gradient logo).
- noindex on banned page.

### Blockers / next steps (see PRE-LAUNCH-TODO.md)
1. Replace `randomchat.example` placeholder domain everywhere (6 files).
2. Create missing image files: `og.png` (1200x630), `favicon.ico`, `apple-touch-icon.png`.
3. Set `ADMIN_PASSWORD` env var in production (currently defaults to `changeme`).
4. Add a TURN server — STUN-only fails for ~30% of users behind strict NAT.
5. Deploy to Railway/Render with a persistent volume (free tier lacks volumes
   → SQLite wiped on redeploy; switch to Postgres or pay for Hobby tier).

### Repo state
- Git initialized, not yet pushed to a remote.
- `data/` gitignored (SQLite DB regenerates on boot).
- `node_modules/` installed, dev-dep `socket.io-client` added for tests.

## 2026-04-05 — LIVE DEPLOY 🚀

**URL:** https://randomchat-production-ada3.up.railway.app

- GitHub repo: https://github.com/hassanmuh467-design/randomchat
- Railway project: fabulous-commitment
- Admin URL: https://randomchat-production-ada3.up.railway.app/admin
- Admin password: stored in Railway env var `ADMIN_PASSWORD`

**Deploy fix:** Railway picked Node 18 initially, which crashed because
`lib/db.js` uses `node:sqlite` (added in Node 22). Updated
`engines.node` to `>=22` and added `.nvmrc`. Commit `90765af`.

**Production smoke tests (all passing):**
- All 11 static/page endpoints return 200
- Admin protected: 401 without auth, 401 with wrong password, 200 with correct
- Admin API: /api/admin/reports and /api/admin/bans return valid JSON

**Still to do (from PRE-LAUNCH-TODO.md):**
1. Custom domain (replace randomchat.example in 6 files, point DNS)
2. Generate og.png, favicon.ico, apple-touch-icon.png
3. Add TURN server to public/app.js rtcConfig
4. Railway Hobby plan ($5/mo) for persistent volume, OR switch to Postgres —
   currently SQLite gets wiped on every redeploy.

## 2026-04-10 — M & G rebrand + Claude AI integration

Full visual rebrand from "RandomChat" to **M & G — Meet & Greet**, iterated
through two themes, swapped the AI backend from OpenAI to Anthropic Claude,
added opposite-gender AI pairing, and shipped fully working end-to-end.

### Shipped commits
- `14abab6` **Rebrand to M & G — Meet & Greet (playful pastel theme)**
  — cream + lavender/mint/peach palette, Fredoka rounded font, 15 files
  updated, brand name + copy swapped everywhere, 40/40 e2e tests still pass.
  Built with 3 parallel agents (A: core CSS + landing + favicon, B: age
  gate + admin, C: legal pages + metadata).
- `1ce4e44` **Violet twilight theme + faster AI fallback**
  — Pivoted to dark mysterious palette: near-black `#0a0814` with violet
  `#9d4edd` accent, ember pink `#ff6b9d` highlight, Cormorant Garamond
  serif headlines + Inter body. 2 parallel agents. Also bumped AI wait
  from 12s → 4s (then later → 5s).
- `5ae38d5` **Swap OpenAI for Anthropic Claude + opposite-gender AI + 5s fallback**
  — Removed `openai` dep, added `@anthropic-ai/sdk@0.88.0`. Rewrote
  `lib/ai-bot.js` to use `claude-haiku-4-5` with prompt caching
  (`cache_control: ephemeral` on system block). Added 6 guy personas
  (jake, mason, luca, ryan, ethan, noah) alongside the 6 girl personas
  (maya, jess, sarah, alex, nina, chloe). `pickPersona(userGender)` now
  returns opposite gender. Punched up the flirty voice with
  gender-specific reaction vocab and opener pools. Added "I'm a [Guy|Girl]"
  pill toggle on the landing page. Client sends gender in `find` payload;
  server stores `socket.data.gender` and passes to `startConversation`.
- `d58c45c` **Mirror local video preview horizontally**
  — One-line CSS fix: `transform: scaleX(-1)` on `#localVideo` so the
  PiP behaves like a mirror. Remote video stays un-mirrored.

### Live end-to-end verified
Ran live socket.io-client tests against production. Both directions
confirmed in-character and responsive:
- Guy user → paired with `jess` (girl persona) → opener "omg hi" → user
  sent "hey whats up" → Claude reply (in character, flirty, short,
  lowercase with abbreviations).
- Girl user → paired with `mason` (guy persona) → opener "hey hows it
  going" → user sent "hey tell me something cool" → Claude replied with
  a persona-specific message about guitar pedals.

### Gotchas learned (for future sessions)
- **Railway doesn't auto-deploy on variable changes in current UI.**
  When you add/edit a variable, Railway shows an **"Apply 1 change"**
  banner at the top with a **Deploy** button. The change is STAGED
  until you click Deploy. Easy to miss.
- **Railway variable edit view reveals plaintext.** Clicking the
  three-dot menu → Edit on an existing variable shows the full value in
  a textarea, not a masked field. Don't screenshot while editing.
  Exposed one key briefly during debugging; had to rotate.
- **Anthropic "credit balance too low" error is not always literal.**
  We saw this error persistently even after the org had $9.71 balance,
  fine rate limits, no spend cap hit, and correct workspace. Root cause
  was unclear — possibly a sync delay between Stripe payment and API
  enforcement, or a key-specific issue. Resolution: create a brand new
  key, replace Railway variable, click **Deploy**. After that everything
  worked immediately.
- **Anthropic "Last used: Never" on a key does NOT mean it hasn't been
  called.** We observed `spark chat` showing "Never used" even though
  Railway was actively calling the API with it. The UI timestamp seems
  to lag or only update on successful calls.

### Files touched (today's session)
- `lib/ai-bot.js` — full rewrite (Anthropic SDK, guy personas, gender-aware)
- `server.js` — AI_WAIT_MS tunable + gender storage + opposite pairing
- `public/index.html` — brand swap, gender pill toggle, Fredoka→Cormorant font
- `public/style.css` — two full rewrites (pastel then dark), gender pill
  styles, local video mirror transform
- `public/favicon.svg` — rewritten twice (pastel then violet gradient)
- `public/app.js` — `getGender()` helper + partner-left copy
- `public/age-gate.css` — two full rewrites
- `public/age-gate.js` — M & G brand copy
- `public/admin/index.html` + `admin.css` — brand + dark theme swaps
- `public/legal/{terms,privacy,banned}.html` — brand + theme updates
- `README.md` — title, tagline, stack doc
- `package.json` — name `m-and-g`, `openai` removed, `@anthropic-ai/sdk` added
- `.gitignore` — added `.claude/`

### Configured on Railway
- `ANTHROPIC_API_KEY` — fresh key (`mng-railway`) pasted + Deployed
- `ADMIN_PASSWORD` — unchanged from prior session
- All other env vars auto-provisioned by Railway

### Next steps
1. 🔐 **Revoke the exposed `spark chat` key** at console.anthropic.com →
   workspaces/default/keys (brief exposure during debugging session)
2. Monitor Anthropic credit balance — currently $9.71, good for ~3,000
   Haiku 4.5 conversations
3. Custom domain still TODO (randomchat.example placeholder in 6 files)
4. TURN server still TODO — STUN-only fails for ~30% of strict-NAT users
5. Railway Hobby plan or Postgres migration for SQLite persistence
6. Generate `og.png`, `favicon.ico`, `apple-touch-icon.png`
7. Consider: graceful AI fallback message when Claude fails
   ("brb my phone's dying 😅") instead of silent drop

### Blockers
None right now. App is live, themed, and AI is responding.
