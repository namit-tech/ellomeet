# 🎥 Meet — a Google Meet / Zoom style video app

Group video calls for up to 20 people, on web and Android, using **WebRTC**
through a self-hostable **LiveKit** SFU.

**Media goes through a server.** Everyone publishes once and the SFU forwards to
everyone else — that is what makes 20 people possible, and it is why this is not
end-to-end private. An earlier version was a true peer-to-peer mesh; that
topology caps out around 4–6 people (see [PLAN.md](PLAN.md) §1).

The Node server owns the *rules* — roster, host controls, waiting room, lock,
chat — and never touches media.

## Structure

```
meet/
├── server/   # Node + Express + Socket.IO — rules, roster, LiveKit tokens
├── client/   # React + Vite web client
├── mobile/   # React Native (Android; iOS not built)
└── deploy/   # LiveKit SFU + observability compose files
```

## Run it locally

You need three things: the server, the client, and an SFU.

**1. An SFU.** Fastest is [LiveKit Cloud](https://cloud.livekit.io)'s free tier —
create a project, copy the URL and key pair. Self-hosting instead? See
[deploy/livekit/README.md](deploy/livekit/README.md).

```bash
cd server
cp .env.example .env     # then fill in LIVEKIT_URL / _API_KEY / _API_SECRET
npm install
npm run dev              # http://localhost:3001
```

Without those three variables the app runs but no audio or video can flow — the
UI will say so rather than sitting on a black tile.

**2. Client**
```bash
cd client
npm install
npm run dev              # http://localhost:5173
```

Open http://localhost:5173, click **New meeting**, then open the same room URL
in another tab or device.

> 💡 The client points its signalling connection at the same host on port 3001,
> so opening it on your LAN IP works for testing across devices. Media goes to
> the SFU regardless of where the page is served from — you can develop locally
> against a remote SFU.

**3. Mobile** — see [mobile/README.md](mobile/README.md).

## Features

- Create / join rooms via shareable link
- Up to 20 participants, with paginated tiles and active-speaker spotlight
- Multiple people can present at once; each screen is its own tile
- Pin, click-to-spotlight, and fullscreen on any tile
- Screen sharing (desktop browsers and Android; **not** mobile browsers — no
  browser on iOS or Android implements `getDisplayMedia`)
- Mute / camera toggle, raise hand, reactions, text chat
- Host controls: mute, remove, lock, waiting room, end for all
- **Virtual backgrounds** — blur or your own image, web only
- Light & dark themes

### Notes on virtual backgrounds

- Segmentation runs **entirely in the browser** (MediaPipe Selfie
  Segmentation), self-hosted at `/mediapipe/*` — no external CDN.
- Loaded lazily: the model is only fetched when someone actually picks an
  effect, and the processor is detached when set back to "none" so nobody pays
  for a canvas pipeline they aren't using.
- Not available on mobile — React Native has no `<canvas>`.

## Going to production

1. **HTTPS is mandatory.** Browsers block camera/mic on non-secure origins
   (localhost is exempt for dev).
2. **Run an SFU** — [deploy/livekit/](deploy/livekit/). The step that catches
   people is opening the UDP media range; signalling connects over TCP and the
   call then carries no audio or video.
3. **Scaling out** — set `REDIS_URL` and rooms move to Valkey with Socket.IO
   broadcasts routed through it, so N server instances behave as one.
4. **Measure before sizing** — [deploy/observability/](deploy/observability/).

Capacity arithmetic, cost per provider, and the remaining roadmap are in
[PLAN.md](PLAN.md).
