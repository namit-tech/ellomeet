# Deploying Meet to a VPS — meet.elloindia.in

Target: **Ubuntu/Debian VPS**, deployed via **git clone**, served over **HTTPS**
by Nginx, with the Node signaling server running under systemd. TURN is handled
by Metered (no coturn needed).

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
METERED_DOMAIN=ellomeet.metered.live
METERED_API_KEY=<your Metered API key>
```

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
sudo ufw allow 'Nginx Full'    # opens 80 + 443
sudo ufw enable
```

The signaling server (3001) stays internal — only Nginx talks to it, so it does
not need a firewall opening.

---

## 9. Verify the whole thing

1. Open **https://meet.elloindia.in** in two different browsers/devices.
2. Create a meeting in one, paste the invite link into the other.
3. You should see two-way video. Try **Effects → Blur** and screen share.
4. To confirm TURN is actually used on hard networks, test between a laptop on
   Wi-Fi and a phone on mobile data.

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
| Calls work on same Wi-Fi but not across networks | TURN issue — confirm `METERED_API_KEY` is set in `server/.env` and the server logs don't show `[ice] Metered fetch failed`. |
| 502 Bad Gateway | Signaling server isn't running — `sudo systemctl restart meet-signaling`. |
| Socket keeps disconnecting | Ensure the `/socket.io/` proxy block (with Upgrade headers) is present in the Nginx config. |
