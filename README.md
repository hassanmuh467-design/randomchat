# M & G — Meet & Greet

Playful 1-on-1 video + text chat. Say hi to someone new in seconds. No sign up.

## Run locally

```bash
npm install
npm start
```

Open http://localhost:3000 in **two different browser windows** (or one normal + one incognito) to test the pairing.

## Tech

- **Express + Socket.io** — signaling server, handles pairing and chat relay
- **WebRTC** — peer-to-peer video/audio (browser native)
- **Vanilla HTML/CSS/JS** — zero build step, easy to edit
- Google STUN servers for NAT traversal. For production reliability, add a TURN server (see Phase 2).

## Deploy (cheapest path, ~5 min)

1. Push this folder to a new GitHub repo.
2. Sign up at **railway.app** or **render.com** (free tier works).
3. Connect the repo → it auto-detects Node, runs `npm install && npm start`.
4. It assigns you a URL like `meetandgreet-production.up.railway.app`. That's your live app.

> WebRTC requires HTTPS. Both Railway and Render give you HTTPS by default, so this works out of the box.

## Environment

- `PORT` — server port (defaults to 3000; Railway/Render set this automatically)

## Files

| File | Purpose |
|------|---------|
| `server.js` | Matchmaking + signaling relay |
| `public/index.html` | UI markup |
| `public/style.css` | Styling (pastel theme, mobile-ready) |
| `public/app.js` | WebRTC client + Socket.io events |
| `LAUNCH_PLAN.md` | Phased roadmap to launch and grow |
