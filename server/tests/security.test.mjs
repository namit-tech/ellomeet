import { createReporter, connect, wait, eventsOf, mintRoom } from "./harness.mjs";

/**
 * Room identity is the security boundary. These prove: you cannot conjure a room
 * by typing a name, tenants are isolated, and a passcode gates entry.
 */
export default async function securityTests(url) {
  const r = createReporter("room security");

  // --- codes are server-minted and unguessable ------------------------------
  const a = await mintRoom(url);
  r.check("minted code has the xxx-xxxx-xxx shape", /^[a-z2-9]{3}-[a-z2-9]{4}-[a-z2-9]{3}$/.test(a.code), a.code);
  r.check("roomId is tenant.code (default public)", a.roomId === `public.${a.code}`, a.roomId);

  const b = await mintRoom(url);
  r.check("two mints differ", a.code !== b.code);

  // --- a minted room opens; a shared code lands in the SAME room -------------
  const host = connect(url);
  host.emit("join", { roomId: a.roomId, name: "Host", media: { audio: true, video: true } });
  await wait(400);
  r.check("minted code lets the first joiner in", eventsOf(host, "joined").length === 1);

  const guest = connect(url);
  guest.emit("join", { roomId: a.roomId, name: "Guest", media: {} });
  await wait(400);
  r.check("a shared code joins the existing room", guest.state.room?.participants.length === 2);

  // --- typing an id nobody minted is NOT a room -----------------------------
  const stranger = connect(url);
  stranger.emit("join", { roomId: "public.001", name: "Stranger", media: {} });
  await wait(400);
  r.check("typing 001 does not conjure a room", eventsOf(stranger, "room-not-found").length === 1);

  // --- enumeration is dead --------------------------------------------------
  const scanner = connect(url);
  for (const id of ["public.002", "public.abc", "acme.standup", "test", "room1"]) {
    scanner.emit("join", { roomId: id, name: "Scan", media: {} });
    await wait(120);
  }
  r.check("enumeration attempts all fail", eventsOf(scanner, "joined").length === 0);

  // --- TENANCY: same code, different tenants, different rooms ----------------
  const acme = await mintRoom(url, { tenant: "acme" });
  const globex = await mintRoom(url, { tenant: "globex" });
  r.check("acme room is namespaced", acme.roomId.startsWith("acme."));
  r.check("globex room is namespaced", globex.roomId.startsWith("globex."));

  const acmeUser = connect(url);
  acmeUser.emit("join", { roomId: acme.roomId, name: "AcmeUser", media: {} });
  await wait(400);
  const globexUser = connect(url);
  globexUser.emit("join", { roomId: globex.roomId, name: "GlobexUser", media: {} });
  await wait(400);
  r.check(
    "tenants do not see each other's participants",
    acmeUser.state.room?.participants.length === 1 &&
      globexUser.state.room?.participants.length === 1
  );

  // --- PASSCODE: required, wrong bounces, right admits ----------------------
  const locked = await mintRoom(url, { passcode: "1234" });
  r.check("mint reports the room has a passcode", locked.hasPasscode === true);

  const noPass = connect(url);
  noPass.emit("join", { roomId: locked.roomId, name: "NoPass", media: {} });
  await wait(400);
  r.check("joining without the passcode is refused", eventsOf(noPass, "passcode-required").length === 1);
  r.check("...and they are not in the room", eventsOf(noPass, "joined").length === 0);

  const wrongPass = connect(url);
  wrongPass.emit("join", { roomId: locked.roomId, name: "Wrong", media: {}, passcode: "0000" });
  await wait(400);
  r.check("a wrong passcode is refused", eventsOf(wrongPass, "passcode-required").length === 1);

  const rightPass = connect(url);
  rightPass.emit("join", { roomId: locked.roomId, name: "Right", media: {}, passcode: "1234" });
  await wait(400);
  r.check("the correct passcode admits", eventsOf(rightPass, "joined").length === 1);

  [host, guest, stranger, scanner, acmeUser, globexUser, noPass, wrongPass, rightPass].forEach((s) => s.close());
  await wait(150);

  return r.failures;
}
