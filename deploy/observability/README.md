# Measuring capacity, then sizing

The node counts in `PLAN.md` (~20 nodes for 500×20) are estimates, and real
figures move by 2× with codec and resolution. This is how you replace them with
your own numbers.

Do this **before** buying servers, and **before** running more than one node.

## 1. Metrics first

```bash
cd deploy/observability
GRAFANA_PASSWORD='pick-something' docker compose up -d
```

Grafana on `http://127.0.0.1:3010`. Add Prometheus (`http://127.0.0.1:9090`) as
a data source, then import LiveKit's published dashboard.

Do not expose port 3010 to the internet — put it behind the same Nginx with auth.

## 2. Find one node's ceiling

LiveKit's CLI simulates real publishers and subscribers, so this measures the
actual forwarding cost rather than a synthetic loop:

```bash
lk load-test \
  --url wss://meet.elloindia.in/livekit \
  --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
  --room loadtest --video-publishers 5 --subscribers 5 --duration 2m
```

Watch `livekit_node_cpu_load` while it runs. Step up — 5, 10, 20 publishers —
until a core pins at 100%.

**That participant count is your real per-node capacity.** Divide the target by
it to size the cluster. Everything else in the plan's §3 is arithmetic on top of
that one measured number.

## 3. What to watch, and what it means

| Metric | Reading it |
|---|---|
| `livekit_node_cpu_load` | The capacity signal. Pinned = add a node; tuning will not save you. |
| `livekit_participant_total` | Actual connections, versus what you think you have. |
| `livekit_room_total` | Concurrent rooms — the 500 in the target. |
| `livekit_forward_latency` | Rising here means the SFU is behind, not the network. |
| `livekit_packet_loss`, `nack_total` | High with *low* CPU means the network, not the box. |

That last row is the distinction worth internalising: loss with idle CPU is a
network problem and a bigger server will not fix it.

## 4. Bandwidth is the other ceiling

CPU is what you hit first on a small VPS; **transfer allowance** is what you hit
first on a big month. A 20-person room is roughly 11 TB/hour of egress at full
load. Check the host's monthly cap and port speed alongside these graphs — see
`PLAN.md` §3, where provider choice turns out to matter more than any code
change.
