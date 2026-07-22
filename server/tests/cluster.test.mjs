import { createReporter, connect, wait, eventsOf } from "./harness.mjs";

/**
 * Two server instances, one room.
 *
 * This is the only test that can actually prove the Phase E work, because every
 * bug it targets is invisible with a single process:
 *
 *   - shared state    — instance B must see a member that joined via A, or the
 *                       capacity cap and the host rule are meaningless
 *   - the adapter     — a broadcast published on A must reach a client held by B
 *   - cross-instance  — a host on A must be able to admit a guest on B, which
 *     admission        is what the "admitted" handshake exists for
 *
 * Requires a real Redis/Valkey. Skipped when REDIS_URL is unset, because the
 * memory store is per-process and a second instance would legitimately share
 * nothing — a green run without Redis would be meaningless, so we do not fake
 * one.
 */
export default async function clusterTests(urlA, urlB) {
  const r = createReporter("cluster (two instances)");

  if (!urlB) {
    console.log("SKIP  no REDIS_URL — cluster tests need shared state to be meaningful");
    return 0;
  }

  const room = `cl-${Date.now()}`;

  // Alice on instance A, Bob on instance B.
  const alice = connect(urlA);
  alice.emit("join", { roomId: room, name: "Alice", media: { audio: true, video: true } });
  await wait(400);

  const bob = connect(urlB);
  bob.emit("join", { roomId: room, name: "Bob", media: { audio: true, video: true } });
  await wait(500);

  r.check(
    "instance B sees the member who joined on A",
    bob.state.room?.participants.length === 2,
    `saw ${bob.state.room?.participants.length}`
  );
  r.check(
    "instance A sees the member who joined on B",
    alice.state.room?.participants.length === 2,
    `saw ${alice.state.room?.participants.length}`
  );
  r.check(
    "host elected on A is recognised on B",
    bob.state.room?.hostId === alice.id
  );

  // A broadcast published on B must reach a client connected to A.
  bob.emit("chat", { text: "across the cluster" });
  await wait(400);
  r.check(
    "chat published on B reaches a client on A",
    alice.state.chat.some((m) => m.text === "across the cluster")
  );

  // Presence changes must cross too.
  bob.emit("state", { audio: false });
  await wait(400);
  r.check(
    "mute state set on B is visible on A",
    alice.state.room?.participants.find((p) => p.id === bob.id)?.audio === false
  );

  // The hard one: host on A admits a guest whose socket lives on B.
  alice.emit("host:lock", { locked: true });
  await wait(300);

  const carol = connect(urlB);
  carol.emit("join", { roomId: room, name: "Carol", media: { audio: true, video: true } });
  await wait(450);
  r.check("guest on B is put in the lobby", eventsOf(carol, "waiting").length === 1);
  r.check("host on A sees the knock from B", alice.state.room?.waiting.length === 1);

  alice.emit("host:admit", { id: carol.id });
  await wait(700); // admitted -> client re-joins -> joined

  r.check("host on A admits a guest held by B", eventsOf(carol, "joined").length === 1);
  r.check("admitted guest appears on A's roster", alice.state.room?.participants.length === 3);

  alice.close();
  bob.close();
  carol.close();
  await wait(200);

  return r.failures;
}
