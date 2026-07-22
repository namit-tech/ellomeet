import { createReporter, connect, wait, eventsOf } from "./harness.mjs";

/**
 * The media credential must follow admission, not the request for it.
 *
 * LiveKit knows nothing about our waiting room, our lock, or our host — to the
 * SFU a valid token IS permission. So the property that actually keeps someone
 * out of a locked meeting is that they never receive one, and that property is
 * worth a test rather than a comment.
 */
export default async function livekitTests(url) {
  const r = createReporter("livekit tokens");

  const room = `lk-${Date.now()}`;

  // --- an admitted member gets a token ---
  const host = connect(url);
  host.emit("join", { roomId: room, name: "Host", media: { audio: true, video: true } });
  await wait(400);

  const hostTokens = eventsOf(host, "livekit");
  r.check("admitted member receives a livekit credential", hostTokens.length === 1);

  if (hostTokens.length) {
    const { token, url: lkUrl } = hostTokens[0].payload;
    r.check("credential carries a token and a url", !!token && !!lkUrl);

    // Decode the JWT payload without verifying — we only assert on scope here.
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    r.check("token is scoped to this room only", claims.video?.room === room, claims.video?.room);
    r.check("token grants join", claims.video?.roomJoin === true);
    r.check(
      "token cannot create rooms or administer them",
      !claims.video?.roomCreate && !claims.video?.roomAdmin
    );
    r.check("token expires", typeof claims.exp === "number" && claims.exp > Date.now() / 1000);
  }

  // --- someone stuck in the waiting room gets nothing ---
  host.emit("host:lock", { locked: true });
  await wait(250);

  const knocker = connect(url);
  knocker.emit("join", { roomId: room, name: "Knocker", media: { audio: true, video: true } });
  await wait(450);

  r.check("knocker is put in the waiting room", eventsOf(knocker, "waiting").length === 1);
  r.check(
    "knocker receives NO livekit credential while waiting",
    eventsOf(knocker, "livekit").length === 0
  );

  // --- and gets one the moment the host admits them ---
  host.emit("host:admit", { id: knocker.id });
  await wait(450);

  r.check(
    "admitting the knocker issues their credential",
    eventsOf(knocker, "livekit").length === 1
  );

  host.close();
  knocker.close();
  await wait(150);

  return r.failures;
}
