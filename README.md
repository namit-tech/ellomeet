# 🎥 Meet — a minimal Google Meet / Zoom clone

Peer-to-peer video calls for small groups (2–4 people) using **WebRTC**.
Video/audio flows directly between browsers; the Node server only handles
signaling and chat relay.

## Structure

```
meet/
├── server/   # Node + Express + Socket.IO signaling server
└── client/   # React + Vite frontend (WebRTC mesh)
```

## Run it locally

Open two terminals.

**1. Signaling server**
```bash
cd server
npm install
npm run dev        # http://localhost:3001
```

**2. Client**
```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

Open http://localhost:5173, click **New meeting**, then open the same room
URL in a second browser tab/window (or another device on your network) to see
the call connect.

> 💡 To test between two devices, open the client on your LAN IP
> (Vite prints it, e.g. `http://192.168.1.x:5173`). The client auto-points its
> signaling connection at the same host on port 3001.

## Features

- Create / join rooms via shareable link
- Live video + audio, up to 4 in a mesh
- Mute mic / toggle camera
- Screen sharing
- **Virtual backgrounds** — blur, built-in presets, or upload your own image
  (on-device segmentation via MediaPipe; nothing leaves the browser)
- **Light & dark themes** — proper themed UI, remembers your choice
- Professional icon-based UI (lucide icons, no emojis)
- Text chat
- Responsive tile grid

### Notes on virtual backgrounds

- Segmentation runs **entirely in the browser** (MediaPipe Selfie Segmentation).
  The model/wasm files are self-hosted at `/mediapipe/*` (copied from the npm
  package at build time — no external CDN).
- It is CPU-intensive; best on Chrome/Edge on a reasonably modern machine.
- If the model can't load, the app gracefully falls back to a normal camera
  feed so calls still work.

## Going to production — read this

1. **TURN server required.** STUN alone (the default config) fails on ~10–20%
   of real networks. Add TURN credentials in
   [`client/src/lib/iceServers.js`](client/src/lib/iceServers.js). Easiest:
   a free TURN service like metered.ca or Twilio, or self-host coturn.
2. **HTTPS is mandatory.** Browsers block camera/mic on non-secure origins
   (localhost is exempt for dev).
3. **Deploy:** client → Vercel/Netlify (static), server → Render/Railway/Fly.io
   (must support WebSockets). Set `VITE_SIGNALING_URL` on the client and
   `CLIENT_ORIGIN` on the server.

## Beyond 4 people

Full mesh doesn't scale past ~4 (every peer connects to every other). For
larger rooms you'd swap the client to talk to an **SFU** media server
(mediasoup, LiveKit) instead of direct peer connections.
