import { createReporter, wait, connect, self, wasRejected } from "./harness.mjs";

/**
 * A connected client is untrusted input. Every one of these payloads used to
 * reach domain code untouched; the Zod layer in validation/ now drops them at
 * the transport boundary.
 */
export default async function run(url) {
  const r = createReporter("validation");

  const alice = connect(url);
  const mallory = connect(url);

  alice.emit("join", { roomId: "v1", name: "Alice", media: { audio: true, video: true } });
  await wait(300);
  mallory.emit("join", { roomId: "v1", name: "Mallory", media: {} });
  await wait(400);
  r.check("baseline: both joined", alice.state.room?.participants.length === 2);

  // Wrong types would previously have been written straight onto the roster.
  mallory.emit("state", { audio: "yes", video: 1 });
  await wait(250);
  r.check("non-boolean state patch is rejected", wasRejected(mallory, "state"));
  r.check("...and the roster is not corrupted", self(mallory)?.audio === true);

  const before = alice.state.chat.length;
  mallory.emit("chat", { text: "x".repeat(50_000) });
  await wait(250);
  r.check("oversized chat message is rejected", wasRejected(mallory, "chat"));
  r.check("...and is not broadcast", alice.state.chat.length === before);

  mallory.emit("chat", { text: "   " });
  await wait(200);
  r.check("whitespace-only chat is rejected", alice.state.chat.length === before);

  // Reactions are broadcast to everyone, so the payload must not be free-form.
  mallory.emit("reaction", { emoji: "<img src=x onerror=alert(1)>" });
  await wait(250);
  r.check("arbitrary reaction payload is rejected", wasRejected(mallory, "reaction"));

  mallory.emit("host:remove", { id: { $ne: null } });
  await wait(250);
  r.check("non-string host target is rejected", wasRejected(mallory, "host:remove"));
  r.check("...and nobody was removed", alice.state.room.participants.length === 2);

  mallory.emit("offer", { to: alice.id, sdp: "not-an-sdp-object" });
  await wait(250);
  r.check("malformed SDP envelope is rejected", wasRejected(mallory, "offer"));

  mallory.emit("join", { roomId: "" });
  await wait(250);
  r.check("empty roomId is rejected", wasRejected(mallory, "join"));

  // Shape-valid but unauthorised: signaling is limited to your own room, so a
  // stranger can't push SDP at a participant they were never in a call with.
  const outsider = connect(url);
  await wait(300);
  outsider.emit("offer", {
    to: alice.id,
    sdp: { type: "offer", sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n" },
  });
  await wait(300);
  r.check("well-formed SDP from a non-member is dropped", !wasRejected(outsider, "offer"));

  // And none of this may break the legitimate path.
  mallory.emit("state", { audio: false });
  mallory.emit("chat", { text: "legit message" });
  await wait(300);
  r.check("valid state patch still applies", self(mallory)?.audio === false);
  r.check("valid chat still broadcasts", alice.state.chat.some((m) => m.text === "legit message"));

  [alice, mallory, outsider].forEach((s) => s.disconnect());
  await wait(200);

  return r.failures;
}
