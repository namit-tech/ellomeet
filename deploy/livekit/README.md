# Self-hosting the LiveKit SFU

Runs on the same VPS as the signalling server. Media goes to LiveKit; the rules
(roster, host controls, waiting room, chat) stay in the Node server.

## 1. Generate real keys

```bash
docker run --rm livekit/livekit-server generate-keys
```

The key pair is just two random strings — an identifier conventionally prefixed
`API`, and a secret of at least 32 characters. If Docker isn't up yet, this is
equivalent and needs nothing but openssl:

```bash
echo "API$(openssl rand -hex 6)"   # the key
openssl rand -base64 36            # the secret
```

Put the pair in `livekit.yaml` under `keys:`, and the **same** pair in the Node
server's `.env`:

```
LIVEKIT_URL=wss://meet.elloindia.in/livekit
LIVEKIT_API_KEY=API...
LIVEKIT_API_SECRET=...
```

The secret is the trust anchor between the two processes. It must never be sent
to a browser — the client only ever receives a short-lived JWT scoped to one
room, minted in `services/livekit.service.js`.

## 2. Open the firewall

This is where most self-hosted deployments fail: the call connects, then no
audio or video arrives, because media UDP is blocked while signalling over TCP
succeeded.

```bash
sudo ufw allow 7880/tcp          # signalling
sudo ufw allow 7881/tcp          # TCP media fallback
sudo ufw allow 50000:60000/udp   # media
sudo ufw allow 3478/udp          # TURN
sudo ufw allow 5349/tcp          # TURN over TLS
```

## 3. Let LiveKit read the TLS certificate

The container runs as a non-root user and needs the Let's Encrypt files Nginx
already has:

```bash
sudo setfacl -R -m u:1000:rX /etc/letsencrypt/live /etc/letsencrypt/archive
```

## 4. Proxy the WebSocket through Nginx

Add inside the existing `server { }` block for `meet.elloindia.in`, **above**
the `location /` block so it matches first:

```nginx
location /livekit {
    proxy_pass http://127.0.0.1:7880;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # A call is a long-lived connection; the 60s default would cut it.
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

Only the WebSocket goes through Nginx. **Media does not** — it flows directly
over the UDP range, which is why step 2 matters more than this one.

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Start it

```bash
cd deploy/livekit
docker compose up -d
docker compose logs -f livekit
```

Health check:

```bash
curl http://127.0.0.1:7880    # expects "OK"
```

## 6. Verify before trusting it

`docker compose ps` proving the container is up says nothing about whether media
works. Confirm end to end with two devices on *different* networks — one on
mobile data — because two machines on the same LAN will connect even when every
firewall rule above is wrong.

## Capacity

A 20-person room is roughly 20 Mbps inbound and can reach 100–200 Mbps outbound
at peak. Check the VPS port speed and monthly transfer allowance before relying
on this; bandwidth runs out long before CPU does.
