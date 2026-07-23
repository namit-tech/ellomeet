# Ello Meet — server architecture & deploy runbook

Read this first. If the server is misbehaving, it is almost always because one
of the four boxes below is pointing at the wrong place. This document is the
single source of truth for what runs where.

---

## 1. The whole system on one page

There are **two domains** and **three processes**. Keep them straight and
everything works.

```
                    ┌─────────────────────────────────────────────┐
   Browser  ───────▶│  meet.elloindia.in        (nginx)           │
   / Phone          │    • serves the website (client/dist)       │
                    │    • /livekit    → 127.0.0.1:7880 (SFU)      │
                    │    • /.well-known/assetlinks.json → a file   │
                    └─────────────────────────────────────────────┘
                                     │
                    ┌─────────────────────────────────────────────┐
   Browser  ───────▶│  meetapi.elloindia.in     (nginx)           │
   / Phone          │    • everything → 127.0.0.1:3001 (Node)     │
                    └─────────────────────────────────────────────┘

   Processes on the VPS:
     1. Node signalling server   systemd     127.0.0.1:3001
     2. LiveKit SFU              docker      127.0.0.1:7880  + UDP 50000-60000
     3. nginx                    system      443 for both domains
```

### Who does what — and why two domains

| Domain | Serves | Backed by |
|---|---|---|
| **meet.elloindia.in** | the website (static files) + the SFU signalling path `/livekit` | nginx → `client/dist` and → LiveKit |
| **meetapi.elloindia.in** | the API: rooms, roster, chat, host controls, LiveKit tokens | nginx → Node on `:3001` |

They are split on purpose: the website is static and cacheable; the API is a
live socket server. **Do not merge them and do not swap them.** The single most
common breakage is the website trying to reach the API on the wrong domain.

### How a call actually connects (the data flow)

1. Browser loads the site from **meet.elloindia.in**.
2. The site opens a socket to **meetapi.elloindia.in** (the Node server). This
   is where join / roster / chat / host controls / waiting room live.
3. When the Node server admits you, it mints a **LiveKit token** and sends it
   over that socket.
4. The browser uses the token to connect to the **SFU** at
   `wss://meet.elloindia.in/livekit`. Audio and video flow there — never through
   the Node server.

If any one of those four hops points at the wrong host, you get a black screen
or "can't connect". §4 checks each hop in order.

---

## 2. The one setting that ties it together

The website is a **static build**. The API URL is baked in **at build time**,
not at runtime. That URL comes from `client/.env.production`:

```
VITE_SIGNALING_URL=https://meetapi.elloindia.in
```

**Consequence:** if you build the website without this file (or with the wrong
value), the site tries to reach the API on its own origin (meet.elloindia.in),
which does not run the API — and nothing connects. This is the current bug: the
deployed bundle predates this file.

The fix is simply to rebuild the website on the server (§3, step C). The file is
already in the repo.

---

## 3. Deploy sequence (do these in order)

Everything below runs on the VPS. All the recent work exists only in the git
repo — pull it first.

### A. Get the code

```bash
cd /var/www/meet
git pull
```

### B. Node server (the API on meetapi)

```bash
cd /var/www/meet/server
npm install --omit=dev          # new deps: livekit-server-sdk, ioredis, adapter

# Confirm .env has these (edit if missing):
#   LIVEKIT_URL=wss://meet.elloindia.in/livekit
#   LIVEKIT_API_KEY=...           (must match deploy/livekit/livekit.yaml)
#   LIVEKIT_API_SECRET=...        (must match deploy/livekit/livekit.yaml)
#   MAX_PEERS=20
nano .env

sudo systemctl restart meet-signaling
curl -s https://meetapi.elloindia.in/health          # must print {"ok":true}
```

If `/health` prints HTML instead of `{"ok":true}`, nginx for meetapi is not
proxying to Node — fix that before anything else.

### C. Website (the static site on meet) — THIS FIXES THE CURRENT BUG

```bash
cd /var/www/meet/client
npm install
npm run build                    # bakes in VITE_SIGNALING_URL from .env.production

# prove the new bundle knows the API host:
grep -rl meetapi dist/assets/*.js && echo "OK: API host baked in"
```

nginx already serves `dist/`, so no reload needed for the site itself.

### D. LiveKit SFU (only if not already running)

```bash
cd /var/www/meet/deploy/livekit
docker compose up -d
curl http://127.0.0.1:7880                            # must print OK
```

The keys in `livekit.yaml` MUST equal `LIVEKIT_API_KEY` / `_API_SECRET` in the
Node server's `.env`. That shared secret is what makes a token the Node server
mints acceptable to the SFU. If they differ, clients connect and then get
rejected by the SFU.

### E. App Links file (so invite links open the Android app)

Add to the **meet.elloindia.in** server block in your live nginx config, above
`location / {`:

```nginx
location = /.well-known/assetlinks.json {
    alias /var/www/meet/deploy/assetlinks.json;
    default_type application/json;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -s https://meet.elloindia.in/.well-known/assetlinks.json   # must be JSON, not HTML
```

---

## 4. Verify every hop (run top to bottom; stop at the first failure)

```bash
# 1. API reachable and is really the Node server (not the SPA fallback)
curl -s https://meetapi.elloindia.in/health
#    want: {"ok":true}     wrong: <!doctype html>

# 2. API speaks socket.io
curl -s "https://meetapi.elloindia.in/socket.io/?EIO=4&transport=polling" | head -c 40
#    want: 0{"sid":"...    wrong: <!doctype html>

# 3. SFU reachable through nginx
curl -s https://meet.elloindia.in/livekit/rtc/validate | head -c 60
#    want: some LiveKit text (e.g. "no permissions...")   wrong: <!doctype html>

# 4. Website is the NEW build (knows the API host)
curl -s https://meet.elloindia.in/ | grep -o 'index-[^"]*\.js'
#    note the hash; after a rebuild it must change

# 5. App Links file
curl -s https://meet.elloindia.in/.well-known/assetlinks.json | head -c 30
#    want: [{ "relation"...    wrong: <!doctype html>
```

Then the real test: open **https://meet.elloindia.in** on a laptop and the app
on a phone, join the same room. You should see each other. Test across
different networks (one on mobile data) — same-LAN success hides firewall bugs.

---

## 5. The failures you will actually hit

| Symptom | Cause | Fix |
|---|---|---|
| Website loads, black screen, never connects | bundle built without `.env.production` → tries to reach API on meet.elloindia.in | rebuild the client (§3-C) |
| `/health` returns HTML | meetapi nginx not proxying to Node | fix the meetapi server block |
| "Media server not configured" screen | Node has no `LIVEKIT_*` in `.env` | set them, restart Node |
| Joins, roster shows, but no audio/video | UDP media range firewalled | `ufw allow 50000:60000/udp` (+ 3478, 5349, 7881) — see deploy/livekit/README.md |
| Connects locally, fails across networks | TURN blocked | open 3478/udp, 5349/tcp; LiveKit must read the TLS cert |
| assetlinks returns HTML | the `location =` block missing or below `location /` | §3-E |
| Room full at 4 people | old `MAX_PEERS` | set `MAX_PEERS=20`, restart Node |

The rule to remember: **a wrong domain gives you HTML where you expected JSON.**
Whenever a check returns `<!doctype html>`, nginx served the website instead of
the thing you asked for — you are on the wrong host or matching the wrong
`location`.
