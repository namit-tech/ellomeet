# Architecture & delivery plan

**Target:** 500 concurrent meetings × 20 participants = **10,000 concurrent
users**, across web, Android and iOS.

Supersedes the earlier mesh-based mobile plan. The scale target drives the media
architecture, and everything else follows from that.

---

## 1. Why the original design could not get there

A full mesh has every participant send separately to every other participant. At
N people each client runs N-1 outbound connections.

| | 4 users | 20 users |
|---|---|---|
| Outbound video streams per client | 3 | **19** |
| Upload at ~1.2 Mbps each | 3.6 Mbps | **~23 Mbps** |
| Simultaneous encoders | 3 | **19** |

No consumer connection has 23 Mbps *upload*, and no phone survives 19 encoders.
Mesh is correct to ~4–6 people and impossible beyond. This is a property of the
topology, not something tuning fixes.

---

## 2. How Zoom and Google Meet actually do it

Neither meshes; neither transcodes centrally (an MCU composites server-side and
costs ~100× the CPU). Both run a **Selective Forwarding Unit**: everyone uploads
once, the server forwards. Upload stays flat whether the room holds 4 or 400.

Five techniques on top, and these are what make large calls usable:

**a. Simulcast.** Publishers encode several resolutions at once (180p / 360p /
720p) and send all of them. The SFU picks a layer per receiver — thumbnails get
180p, the spotlight gets 720p — so the server forwards bytes it never decodes.

**b. Only forward what is on screen.** Meet renders at most 49 tiles, Zoom 25 or
49 per page. Everyone else is audio-only and simply not subscribed.

**c. Dominant-speaker detection.** Mixing 20 live microphones is noise. Both
forward roughly the top three by energy and drop the rest at the server.

**d. Per-receiver bandwidth allocation.** The SFU estimates each *viewer's*
capacity and spends it across that viewer's subscriptions. Degradation is a
per-viewer decision, not a publisher-wide one.

**e. Stop producing what nobody consumes.** If no one subscribes to a high
layer, stop encoding it. Battery and upstream, phones especially.

### Mapping to LiveKit

| Technique | LiveKit |
|---|---|
| Simulcast | `publishDefaults.simulcast` (on) |
| Subscribe to visible tiles only | `adaptiveStream: true` |
| Stop encoding unused layers | `dynacast: true` |
| Dominant speaker | `RoomEvent.ActiveSpeakersChanged` |
| Per-receiver allocation | server-side, automatic |

All five are configured explicitly in `client/src/model/livekitRoom.js` rather
than left to defaults, because they are the reason this scales.

---

## 3. Capacity at 500 × 20

Per participant, with simulcast and dynacast working:

| | Per participant | Per room (20) | × 500 rooms |
|---|---|---|---|
| Ingress | ~1.5 Mbps | 30 Mbps | **15 Gbps** |
| Egress | ~2.5 Mbps | 50 Mbps | **25 Gbps** |
| | | | **~40 Gbps sustained** |

Egress alone is roughly **11 TB per hour** at full load.

Treat these as order-of-magnitude — real figures move 2× with codec and
resolution. Phase G exists to replace them with measured numbers.

**The shape of this problem is favourable.** Rooms are independent: nobody in
room 1 needs anything from room 2. LiveKit assigns each room to a single node,
so 500 rooms across ~20 nodes is ~25 rooms and ~500 participants per node.
Adding capacity is adding a node. (A single *10,000-person* room would need
inter-node stream cascading and is genuinely hard. 500 × 20 is not that.)

### Cost — the provider decision dominates everything

At 25 Gbps sustained egress:

| Provider | Approx. monthly |
|---|---|
| Hetzner / OVH — dedicated, generous transfer | **~€1–2k** all in |
| AWS / GCP at ~$0.09/GB egress | **~$45k** |

Same code, same architecture, 20–30× difference. Video is almost pure egress and
hyperscalers price egress punitively. This is why Zoom and Discord run their own
metal. **No optimization you can write competes with getting this choice right.**

---

## 4. Tooling — what to use and why

### Shared state and cross-instance messaging → **Valkey** (Redis protocol)

The current server keeps rooms in a JavaScript `Map`. Two instances would
disagree about who is in a room, so that state has to move somewhere both can
see, and broadcasts have to reach clients connected to *other* instances.

Options considered:

| Option | Verdict |
|---|---|
| **Valkey** | **Chosen.** BSD-licensed Redis fork under the Linux Foundation; now the default in most cloud catalogues. |
| Redis | Equally fine. Relicensed to SSPL in 2024, added AGPLv3 again in 2025. Identical protocol. |
| KeyDB | Multithreaded Redis fork. Less momentum; no advantage at this scale. |
| NATS | Excellent pub/sub, but we also need a keyed store, so it means running two systems. |
| PostgreSQL | Wrong tool. This state is ephemeral and high-churn. |
| etcd / Hazelcast | Built for consensus and clustering we do not need. |

Valkey and Redis speak the same wire protocol, so `ioredis` and the socket.io
adapters work unchanged and switching later is a config change. Either is a
defensible pick; this plan says Valkey for the licence and ecosystem momentum.

**The decisive argument is that we need it regardless: LiveKit requires Redis to
run more than one node.** One Valkey instance serves both LiveKit's node
coordination and our socket.io adapter. It is not a new dependency — it is a
dependency we already have, used twice.

### Adapter → `@socket.io/redis-streams-adapter`

Prefer the Streams adapter over the classic pub/sub one: Redis pub/sub is
fire-and-forget, so a client reconnecting during a blip can miss messages.
Streams keep an acknowledged log.

### The rest

| Need | Tool |
|---|---|
| Load balancing | Nginx or HAProxy, **sticky sessions on** (socket.io requires it unless transport is websocket-only) |
| Metrics | Prometheus + Grafana — LiveKit exports natively |
| Load testing | `lk load-test` |
| Massive viewer tier (if ever) | LiveKit Egress → HLS → CDN |

---

## 5. Phases

### ✅ Phase A — LiveKit infrastructure *(done)*
`docker-compose` + config in `deploy/livekit/`. Token minted in
`services/livekit.service.js` and issued **only** from `admit()` — LiveKit knows
nothing of our waiting room, so to the SFU a valid token *is* permission, and
the lobby is enforced by never issuing one. Tests cover that gate.

### ✅ Phase B — Web client on LiveKit *(built, unverified)*
`useLiveKit` replaces `useWebRTC`. `adaptiveStream` + `dynacast` + simulcast on.
Tiles use `track.attach()` — assigning `srcObject` by hand bypasses the element
observer adaptive stream depends on. Virtual backgrounds preserved by publishing
the processor's canvas track as the camera source. `useSpeaking` deleted in
favour of SFU dominant-speaker detection.

**Blocked on:** real keys on the VPS, then a two-device call.

### ✅ Phase C — UI for 20 *(done)*
9 tiles per grid page, 6 per filmstrip page, with a pager. Active speakers are
promoted onto the visible page. The saving is not cosmetic: an unrendered tile
is never attached, so adaptive stream pauses it at the server — roughly halving
what each client pulls in a 20-person room.

### ✅ Phase D — Dynamic quality by room size *(done)*
`setPublishingQuality` caps the top simulcast layer in place — no republish, no
renegotiation, no visible gap. Two tiers: 720p ceiling at ≤6 participants, 360p
above. Both clients share the thresholds.

Floor is deliberately 360p rather than 180p: simulcast already sends thumbnails
the 180p layer and dynacast already stops encoding unsubscribed layers, so the
ceiling's real job is bounding the worst case — in a big room *someone* is
always spotlighted, and without it every publisher keeps a 720p encode running.
Going lower would save little and make a spotlighted face unusable.

### ✅ Phase E — Stateless signalling *(built; Redis path unverified)*
Store abstraction with memory and Redis implementations behind one interface.
`REDIS_URL` unset keeps the old single-instance behaviour exactly; set, it moves
rooms to Valkey **and** routes Socket.IO through the streams adapter. Both
halves come from one variable because neither is useful alone.

`Room` is storage-free (`fromState`/`toState`); all mutation goes through
`withRoom`, which loads-applies-persists as one step under a per-room lock.

Two bugs this surfaced, both invisible on a single server:
- **Admission could not cross instances.** `io.sockets.sockets.get(id)` sees
  only local sockets, so a host on A silently failed to admit a guest on B.
  Fixed with an "admitted" handshake: the server marks them approved in shared
  state and their own instance re-runs `join`.
- **`evict()` had the same flaw** — now `io.in(id).socketsLeave()`.

`tests/cluster.test.mjs` spawns two instances and proves shared state,
cross-instance broadcast, and cross-instance admission. It **skips without
REDIS_URL** rather than passing vacuously.

### ✅ Phase F — Android *(built; needs a device)*
`mobile/` runs on `@livekit/react-native`, same rooms and same server as the
web. Screen sharing via `setScreenShareEnabled` (MediaProjection + the
foreground service declared in the manifest). Pagination and publish ceilings
match the web client.

The mesh implementation and the abandoned `client/src/model/` refactor were
deleted — two media stacks would have drifted apart within a month.

### ✅ Phase G — Measure, then size *(config written; needs running)*
`deploy/observability/` — Prometheus + Grafana compose, scrape config, and a
runbook for `lk load-test`. LiveKit's `prometheus_port` is enabled in
`livekit.yaml`.

Run this **before** buying servers: step publishers up until a core pins, and
that number replaces the "~20 nodes" estimate in §3.

### Phase H — Multi-node
LiveKit cluster sharing the Valkey instance from Phase E. Rooms distribute
automatically. Regional nodes if users are geographically spread.

### Phase I — iOS
LiveKit ships the Broadcast Upload Extension boilerplate that was the hardest
item on the old plan. **Still requires a Mac, Xcode, and the $99/yr Apple
Developer Program.** Cannot be built or verified from Windows.

### Phase J — Release
Play Console ($25 once), App Store Connect, privacy policy, data-safety forms.
Back up the Android signing keystore — losing it means never updating the app.

---

## 6. Sequencing advice

**Do not build for 10,000 users before you have 10.** Distributed
infrastructure ahead of demand is a reliable way to burn months.

But three decisions are cheap now and expensive later, so get them right
regardless of current traffic:

1. **No state in process memory that a second server would need** (Phase E).
2. **Roles live in the token, not the UI** — publisher vs viewer decided
   server-side. The grant in `livekit.service.js` already has the hook
   (`canPublish`).
3. **Media and rules stay separate** — already true, and it is what makes the
   SFU swappable.

Recommended order from here: **verify B → C → D → E**, then measure (G) before
spending on nodes (H).

---

## 7. What only you can provide

| Need | Phase | Cost |
|---|---|---|
| LiveKit keys on the VPS | A | free |
| VPS with ≥4 vCPU for a real 20-person room | B | ~$20/mo |
| Valkey instance | E | free (same box initially) |
| Bandwidth-friendly host before real scale | H | see §3 — the big one |
| Mac or macOS CI | I | $0–100/mo |
| Apple Developer Program | I | $99/yr |
| Play Console | J | $25 once |
