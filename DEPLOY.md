# Deploying Meet to a VPS — meet.elloindia.in

Target: **Ubuntu/Debian VPS**, deployed via **git clone**, served over **HTTPS**
by Nginx, with the Node server under systemd and a **LiveKit SFU** in Docker.

Media flows through the SFU, not peer-to-peer — that is what allows 20 people in
a room. LiveKit brings its own TURN, so there is no separate TURN service to
configure.

Run everything below as a sudo-capable user on the VPS unless noted.

---

## 0. Prerequisites

- A VPS with a public IP and SSH access.
- The domain **meet.elloindia.in** ready to point at the VPS.

---

## 1. DNS — point the domain at the VPS

In your DNS provider for `elloindia.in`, add an **A record**:

| Type | Name | Value            |
|------|------|------------------|
| A    | meet | `<YOUR_VPS_IP>`  |

Verify it resolves (may take a few minutes to propagate):

```bash
dig +short meet.elloindia.in     # should print your VPS IP
```

Do not continue to the HTTPS step until this returns the correct IP.

---

## 2. Install Node.js, Nginx, git

```bash
sudo apt update
sudo apt install -y nginx git
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && nginx -v
```

---

## 3. Get the code

```bash
sudo mkdir -p /var/www
sudo chown -R $USER:$USER /var/www
cd /var/www
git clone <YOUR_REPO_URL> meet
cd meet
```

> Not using GitHub yet? Instead of cloning, copy the project up with:
> `rsync -av --exclude node_modules --exclude dist ./ user@VPS:/var/www/meet/`

---

## 4. Configure and start the signaling server

```bash
cd /var/www/meet/server
npm install --omit=dev
cp .env.example .env
nano .env
```

Set `.env` to:

```
PORT=3001
CLIENT_ORIGIN=https://meet.elloindia.in
MAX_PEERS=20

# Must match deploy/livekit/livekit.yaml exactly — see step 4b.
LIVEKIT_URL=wss://meet.elloindia.in/livekit
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
```

Without the three `LIVEKIT_*` values the app still runs, but no audio or video
can flow. The server logs `[livekit] not configured` and the UI says so rather
than showing a black tile forever.

Install the systemd service (the unit file is in `deploy/`):

```bash
sudo cp /var/www/meet/deploy/meet-signaling.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now meet-signaling
sudo systemctl status meet-signaling      # should be "active (running)"
```

Quick check the server responds locally:

```bash
curl localhost:3001/health                 # -> {"ok":true}
```

> The unit runs as `www-data`. Make sure it can read the files:
> `sudo chown -R www-data:www-data /var/www/meet/server`

---

## 4b. The SFU — required, or nothing has video

Full runbook in [`deploy/livekit/README.md`](deploy/livekit/README.md). The short
version:

```bash
# generate a key pair — these are yours to invent, nobody issues them
echo "API$(openssl rand -hex 6)"
openssl rand -base64 36
```

Put the pair in **both** `deploy/livekit/livekit.yaml` (under `keys:`) and
`server/.env`. They are a shared secret between the two processes; if they do
not match, tokens are rejected and no one connects.

```bash
sudo setfacl -R -m u:1000:rX /etc/letsencrypt/live /etc/letsencrypt/archive
cd /var/www/meet/deploy/livekit
docker compose up -d
curl http://127.0.0.1:7880        # -> OK
```

> **Optional — scaling out.** Set `REDIS_URL` in `server/.env` and rooms move to
> Valkey with Socket.IO broadcasts routed through it, so several server
> instances behave as one. One Valkey serves both this and LiveKit's own
> multi-node coordination:
> `docker run -d --name valkey --restart unless-stopped -p 6379:6379 valkey/valkey`

---

## 5. Build the client

```bash
cd /var/www/meet/client
npm install
npm run build          # outputs /var/www/meet/client/dist
```

The client auto-connects its signaling socket to the same origin in production,
so no client env vars are required.

---

## 6. Nginx site (HTTP first)

```bash
sudo cp /var/www/meet/deploy/nginx.conf /etc/nginx/sites-available/meet
sudo ln -s /etc/nginx/sites-available/meet /etc/nginx/sites-enabled/meet
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t          # test config
sudo systemctl reload nginx
```

At this point `http://meet.elloindia.in` should load the app (camera will be
blocked until HTTPS is added — that's next).

---

## 7. HTTPS with Let's Encrypt (required for camera/mic)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d meet.elloindia.in
```

Certbot will obtain the cert, edit the Nginx config to add SSL, and set up the
HTTP→HTTPS redirect automatically. Auto-renewal is installed as a timer; verify:

```bash
sudo certbot renew --dry-run
```

Now open **https://meet.elloindia.in** — camera/mic will work.

---

## 8. Firewall (if enabled)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'      # 80 + 443

# LiveKit media. THIS IS THE STEP EVERYONE MISSES.
sudo ufw allow 7881/tcp          # TCP media fallback
sudo ufw allow 50000:60000/udp   # RTP media
sudo ufw allow 3478/udp          # TURN
sudo ufw allow 5349/tcp          # TURN over TLS
sudo ufw enable
```

The signalling server (3001) and LiveKit's signalling port (7880) stay internal
— only Nginx talks to them.

**Why the UDP range matters:** signalling goes over TCP through Nginx and will
connect happily without it. The call then joins, shows everyone on the roster,
and carries no audio or video at all. If you see that symptom, this is the
cause nine times out of ten.

---

## 9. Verify the whole thing

**First, prove the proxy actually works.** A status code is not enough — check
the body:

```bash
curl -s https://meet.elloindia.in/health
# MUST print {"ok":true}
# If it prints HTML, Nginx is serving the SPA for everything and the Node
# server is not proxied. Nothing will connect.

curl -s "https://meet.elloindia.in/socket.io/?EIO=4&transport=polling" | head -c 60
# MUST start with 0{"sid":"...
```

Then:

1. Open **https://meet.elloindia.in** in two different browsers/devices.
2. Create a meeting in one, paste the invite link into the other.
3. You should see two-way video. Try **Effects → Blur** and screen share.
4. Test between **different networks** — a laptop on Wi-Fi and a phone on mobile
   data. Two machines on the same LAN will connect even when every firewall rule
   above is wrong, so a same-network test proves very little.
5. `docker compose logs -f livekit` should show participants joining.

---

## Updating after code changes

```bash
cd /var/www/meet
git pull
# if server changed:
cd server && npm install --omit=dev && sudo systemctl restart meet-signaling
# if client changed:
cd ../client && npm install && npm run build
```

No Nginx reload needed for client rebuilds — it serves the fresh `dist` files.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Camera blocked | Make sure you're on **https://**, not http. |
| App loads but no connection between peers | Check `sudo systemctl status meet-signaling` and browser console; verify `CLIENT_ORIGIN` matches the domain exactly. |
| **App loads but nothing connects — black screen, 0 participants** | Nginx is serving `index.html` for every path, so the Node server is never reached. Check with `curl https://your-domain/health` — it must print `{"ok":true}`, **not HTML**. If you get HTML, the `/socket.io/` and `/livekit` location blocks are missing from the active site config. Re-copy `deploy/nginx.conf`, `sudo nginx -t`, `sudo systemctl reload nginx`. |
| **Joins fine, roster correct, but no audio or video** | The UDP media range is closed. Re-check step 8 — this is the most common failure by a wide margin. |
| "Media server not configured" screen | `LIVEKIT_*` missing from `server/.env`. Restart the server after adding them. |
| Connects locally but not across networks | TURN. Confirm 3478/udp and 5349/tcp are open and that LiveKit can read the Let's Encrypt cert (`setfacl` in step 4b). |
| Room full at 4 people | `MAX_PEERS` still at its old value — set it to 20 and restart. |
| 502 Bad Gateway | Signaling server isn't running — `sudo systemctl restart meet-signaling`. |
| Socket keeps disconnecting | Ensure the `/socket.io/` proxy block (with Upgrade headers) is present in the Nginx config. |
