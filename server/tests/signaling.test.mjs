import { createReporter, wait, connect, eventsOf, self } from "./harness.mjs";

/**
 * The room state machine, end to end: roster, host authority, the waiting room,
 * the mesh capacity cap, host transfer, chat history.
 *
 * These are the rules that bite in production, and none of them are visible
 * from a single browser tab — which is why they're tested here.
 */
export default async function run(url) {
  const r = createReporter("signaling");

  // --- two people join ------------------------------------------------------
  const alice = connect(url);
  const bob = connect(url);

  alice.emit("join", { roomId: "t1", name: "Alice", media: { audio: true, video: true } });
  await wait(300);
  bob.emit("join", { roomId: "t1", name: "Bob", media: { audio: false, video: true } });
  await wait(400);

  r.check("both people appear on the roster", alice.state.room?.participants.length === 2);
  r.check("first joiner is host", alice.state.room?.hostId === alice.id);
  r.check("late joiner sees the same host", bob.state.room?.hostId === alice.id);
  r.check("join-time mute state is published", self(bob)?.audio === false);
  // The roster snapshot is now the only join notification — mesh needed a
  // separate peer-joined nudge so the newcomer knew who to offer to; the SFU
  // does not.
  r.check(
    "existing member sees the newcomer on the roster",
    alice.state.room?.participants.some((p) => p.id === bob.id)
  );
  r.check(
    "newcomer is handed the room cap",
    eventsOf(bob, "joined")[0]?.payload.maxPeers > 0
  );

  // --- presence state propagates -------------------------------------------
  const bobSeenByAlice = () => alice.state.room.participants.find((p) => p.id === bob.id);

  bob.emit("state", { audio: true, hand: true });
  await wait(250);
  r.check("unmute is seen by others", bobSeenByAlice().audio === true);
  r.check("raised hand is seen by others", bobSeenByAlice().hand === true);

  bob.emit("state", { sharing: true });
  await wait(250);
  r.check("presenting flag is seen by others", bobSeenByAlice().sharing === true);

  bob.emit("reaction", { emoji: "👍" });
  await wait(250);
  r.check("reaction reaches the room", eventsOf(alice, "reaction")[0]?.payload.emoji === "👍");

  // --- host authority is enforced server-side -------------------------------
  bob.emit("host:mute", { id: alice.id }); // Bob is not the host
  await wait(250);
  r.check("non-host cannot mute the host", eventsOf(alice, "force-mute").length === 0);

  alice.emit("host:mute", { id: bob.id });
  await wait(250);
  r.check("host can ask a participant to mute", eventsOf(bob, "force-mute").length === 1);

  alice.emit("chat", { text: "hello from before you arrived" });
  await wait(250);

  // --- lock, knock, admit ---------------------------------------------------
  alice.emit("host:lock", { locked: true });
  await wait(250);
  r.check("room reports locked", alice.state.room.locked === true);

  const carol = connect(url);
  carol.emit("join", { roomId: "t1", name: "Carol", media: {} });
  await wait(400);
  r.check("knocker is put in the waiting room", eventsOf(carol, "waiting").length === 1);
  r.check("knocker is NOT on the roster yet", alice.state.room.participants.length === 2);
  r.check("host sees the knock", alice.state.room.waiting[0]?.name === "Carol");

  bob.emit("host:admit", { id: carol.id }); // not the host
  await wait(250);
  r.check("non-host cannot admit", eventsOf(carol, "joined").length === 0);

  alice.emit("host:admit", { id: carol.id });
  await wait(400);
  r.check("host admits the knocker", eventsOf(carol, "joined").length === 1);
  r.check("admitted person is on the roster", alice.state.room.participants.length === 3);
  r.check("waiting queue is cleared", alice.state.room.waiting.length === 0);
  r.check(
    "late joiner receives chat history",
    eventsOf(carol, "joined")[0].payload.chat.some((m) => m.text === "hello from before you arrived")
  );

  const dave = connect(url);
  dave.emit("join", { roomId: "t1", name: "Dave", media: {} });
  await wait(350);
  alice.emit("host:deny", { id: dave.id });
  await wait(300);
  r.check("host can deny a knocker", eventsOf(dave, "denied").length === 1);

  // --- co-host (Zoom-style shared moderation) -------------------------------
  // Bob is a normal member. Promote him and he should be able to admit from the
  // lobby, which he could not do a moment ago.
  bob.emit("host:promote", { id: carol.id }); // Bob isn't host yet — must fail
  await wait(250);
  r.check(
    "non-host cannot create a co-host",
    !alice.state.room.participants.find((p) => p.id === carol.id)?.isCoHost
  );

  alice.emit("host:promote", { id: bob.id });
  await wait(300);
  r.check("host can promote a co-host", !!self(bob)?.isCoHost);
  r.check("promotion is visible to the whole room", !!alice.state.room.participants.find((p) => p.id === bob.id)?.isCoHost);

  const erin = connect(url);
  erin.emit("join", { roomId: "t1", name: "Erin", media: {} });
  await wait(350);
  r.check("erin is knocking", alice.state.room.waiting.some((w) => w.id === erin.id));

  bob.emit("host:admit", { id: erin.id }); // Bob is a co-host now
  await wait(450);
  r.check("co-host CAN admit from the lobby", eventsOf(erin, "joined").length === 1);

  // Demote Bob; his moderation powers should evaporate.
  alice.emit("host:demote", { id: bob.id });
  await wait(300);
  r.check("host can demote a co-host", !self(bob)?.isCoHost);

  const frank2 = connect(url);
  frank2.emit("join", { roomId: "t1", name: "Frank2", media: {} });
  await wait(350);
  bob.emit("host:admit", { id: frank2.id }); // Bob is a plain member again
  await wait(400);
  r.check("a demoted co-host can no longer admit", eventsOf(frank2, "joined").length === 0);
  alice.emit("host:deny", { id: frank2.id });
  await wait(250);

  // Erin leaves so the capacity test below starts from a known, non-full room.
  erin.close();
  await wait(300);

  // --- capacity (full mesh degrades badly past 4) ---------------------------
  alice.emit("host:lock", { locked: false });
  await wait(250);

  const eve = connect(url);
  const frank = connect(url);
  eve.emit("join", { roomId: "t1", name: "Eve", media: {} });
  await wait(300);
  frank.emit("join", { roomId: "t1", name: "Frank", media: {} }); // the 5th
  await wait(400);
  r.check("5th participant is rejected", eventsOf(frank, "room-full").length === 1);

  // --- removal --------------------------------------------------------------
  alice.emit("host:remove", { id: eve.id });
  await wait(350);
  r.check("host can remove someone", eventsOf(eve, "removed").length === 1);
  r.check("removed person leaves the roster", !alice.state.room.participants.some((p) => p.id === eve.id));
  r.check(
    "removed person disappears from everyone's roster",
    !bob.state.room?.participants.some((p) => p.id === eve.id)
  );

  // --- the host leaving must not orphan the room ----------------------------
  alice.disconnect();
  await wait(450);
  r.check("host role transfers when the host leaves", bob.state.room.hostId === bob.id);

  bob.emit("host:end");
  await wait(350);
  r.check("new host can end the meeting for everyone", eventsOf(carol, "meeting-ended").length === 1);

  [bob, carol, dave, eve, frank].forEach((s) => s.disconnect());
  await wait(200);

  return r.failures;
}
