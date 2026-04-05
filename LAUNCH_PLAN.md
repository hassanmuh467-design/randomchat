# RandomChat — Phased Launch Plan

Goal: launch in days, not months. Each phase is a working product. Don't build Phase 2 until Phase 1 is live with real users.

---

## Phase 1 — MVP Live (Days 1-3) **← you are here**

**Goal:** a working URL strangers can use today.

**What's built:**
- [x] Random 1-on-1 matchmaking
- [x] Video + audio (WebRTC P2P)
- [x] Text chat, typing indicator
- [x] Next / Stop / Report buttons
- [x] Optional interest-based matching
- [x] Mobile-friendly layout
- [x] Live "online" counter

**To launch (~1 hour of work):**
1. Push to GitHub.
2. Deploy to Railway or Render (free tier). You get HTTPS + a public URL.
3. Buy a short domain (Namecheap / Porkbun) — ideas: `chatrr.io`, `peekchat.com`, `heychat.live`. Budget $10-15.
4. Point the domain at the deploy.
5. Open it on your phone and your laptop to test pairing end-to-end.

**Seed your first 50 users (free):**
- Post in 3-5 Discord servers that allow self-promo.
- Post on r/SideProject, r/InternetIsBeautiful, r/WebGames.
- Tweet a 15-second screen recording with the URL.
- Text 10 friends, ask them to share.

**Success metric:** 100 unique visitors and at least one conversation >2 minutes. That proves the loop works.

---

## Phase 2 — Trust, Safety & Reliability (Days 4-10)

**Goal:** make the app usable at scale without it becoming a swamp.

- **TURN server.** Free Google STUN covers ~70% of users. The other 30% behind strict NAT will fail. Add a TURN server (Twilio Network Traversal, Metered.ca, or self-host Coturn). Budget: $5-20/mo at small scale.
- **Basic moderation:**
  - Store reports in a DB (Postgres via Railway, or SQLite file).
  - Auto-ban IP + fingerprint after 3 reports within 24h.
  - Add a "nudity frame check" using a free NSFW JS model (nsfwjs) on a single frame after connection — flag & disconnect if triggered.
- **Age gate modal** on first visit. Store acknowledgment in localStorage.
- **Terms of Service + Privacy Policy** pages. Use a generator (termly.io, iubenda) — required for ad networks and app stores later.
- **Rate limiting** on `find`/`next` to prevent scrapers (1 pair per 2 seconds per IP).
- **Basic analytics:** Plausible ($9/mo) or self-host Umami. Track: starts, pairs formed, median session duration, next-rate.

**Success metric:** 500 DAU, <5% failed video connections, report queue under control.

---

## Phase 3 — Stickiness & Growth Loop (Weeks 2-4)

**Goal:** make people come back and bring friends.

- **Interest tags v2.** Trending-tag bar ("gaming", "music", "late night", "just chatting"). Click a tag to join that queue. This is the single biggest conversion lever Omegle/Ome.tv proved.
- **Gender filter** (self-declared, unverified — this is table stakes, but see Phase 5 for verification).
- **Country filter** (from IP via ipapi.co — free tier).
- **"Add friend" link.** After a good convo, either user can send a one-time reconnect code. If both accept, they're friends and can message asynchronously. This is the retention mechanic Omegle never had.
- **Referral link.** "Share /r/yourcode → get priority matching for your friends."
- **SEO landing pages.** One page per top interest and per country ("chat with strangers from Brazil", "random music chat"). Each ranks on its own.
- **Short-form video.** Record 10-15 funny/wholesome reactions per week (with consent — or use your own face reacting solo). Post on TikTok / Reels / Shorts. This is how Ome.tv, Monkey, and Yubo all scaled. Budget: $0, 1hr/day.

**Success metric:** 5K DAU, 30%+ D1 retention, organic traffic > 50% of sessions.

---

## Phase 4 — Monetization (Month 2+)

Only turn this on once Phase 3 metrics are hit. Monetizing a small app kills growth.

**Revenue streams (ranked by how well they work on chat apps):**

1. **Premium subscription ($4.99-9.99/mo):**
   - Skip waiting queue
   - Gender / country filters (free tier gets one, premium gets both + more)
   - Reconnect with last stranger
   - See who reported you removed (trust score)
   - No ads
2. **Coins / gifts during video chat.** Users buy coins, send virtual gifts to strangers they like. Huge on Asian-market apps (Azar, Monkey). 60%+ of revenue in some apps.
3. **Unlock interests.** Free tier gets 2 interest tags, premium gets 10.
4. **Display ads** on landing page only (never inside the video room — it tanks retention).

**Infra to add:** Stripe (subs), billing page, webhook handler, account system (email magic link — no passwords).

**Target:** 1-2% of DAU on premium at $6/mo avg = real money.

---

## Phase 5 — Scale & Defensibility (Month 3+)

- **Face verification** (liveness check via Persona, Veriff, or a free open model). This is the moat: verified-user-only mode is a premium feature AND your trust story for app stores, payment processors, and press.
- **Mobile apps** (React Native or Capacitor wrapping the web app). iOS/Android unlock 10x the audience, but expect 2-4 week review battles — Apple is hostile to random-stranger chat post-Omegle.
- **Regional matchmaking servers.** Add a Socket.io server per continent, route via geo-DNS. Cuts pairing latency.
- **Content moderation vendor** (Hive, WebPurify) once you hit ~10K DAU and reports become a full-time job.
- **Community.** Discord server for power users, weekly themed events ("movie night room", "language exchange Fridays").

---

## Risk watch-list

- **The Omegle shutdown problem.** Omegle shut down Nov 2023 after losing a lawsuit tied to a minor being connected to a predator. **Age verification and report responsiveness aren't optional** — they're your survival. Build them before you're at 10K users, not after.
- **App store rejection.** Both Apple and Google reject "random stranger video" apps routinely. Mitigation: verified-user-only mode on mobile, clear 18+ gating, in-app reporting.
- **Payment processor bans.** Stripe/PayPal regularly freeze chat/dating apps. Mitigation: have a backup (Paddle, Authorize.net) and clean moderation logs ready to show.
- **Stranger-chat is inherently gender-imbalanced** (~80% male). Your growth loop *must* bring women in faster than men, or the product dies. Short-form content + interest filters + strict harassment bans are how you do this.

---

## 7-day launch checklist

| Day | Task |
|-----|------|
| 1 | Deploy to Railway, buy domain, point DNS |
| 1 | Test video chat on 2 devices, 2 networks |
| 2 | Add ToS/Privacy, age gate modal |
| 2 | Add basic report storage + IP ban list |
| 3 | Post in 5 communities, record 3 TikToks |
| 4 | Add TURN server, Plausible analytics |
| 5 | Add interest tags bar on landing |
| 6 | Watch session metrics, fix #1 drop-off point |
| 7 | Write retrospective, pick Phase 3 feature to build next |

Ship fast. Iterate on what you see, not what you guessed.
