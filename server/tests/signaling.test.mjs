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
  r.check("existing member is told to expect an offer", eventsOf(alice, "peer-joined").length === 1);
  r.check("newcomer is handed the peer list", eventsOf(bob, "joined")[0]?.payload.peers.length === 1);

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
    "others tear down the peer connection",
    eventsOf(bob, "peer-left").some((e) => e.payload.id === eve.id)
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
