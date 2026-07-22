/**
 * Joining, leaving, presence state, reactions.
 *
 * Controllers are thin on purpose: the payload is already validated, the rules
 * live in room.service.js, and the wire lives in broadcast.service.js.
 *
 * One rule that is not optional: any decision that depends on room state must
 * be made INSIDE a `withRoom` callback, together with the mutation it implies.
 * Reading the room, deciding, and then writing in a separate step lets two
 * server instances interleave — that is how a room admits one person too many.
 * The callbacks below therefore return a description of what happened, and the
 * broadcasting is done afterwards from that description.
 */

// Shared by `join` and by the host admitting someone from the waiting room.
export async function admit({ socket, roomId, name, media, deps }) {
  const { registry, broadcast, livekit } = deps;

  const outcome = await registry.withRoom(roomId, (room) => {
    if (room.isFull) return { full: true };
    room.addMember(socket.id, name, media);
    return { full: false, chat: room.chat, maxPeers: room.maxPeers, snapshot: room.snapshot() };
  });

  if (outcome.full) {
    socket.emit("room-full");
    return;
  }

  socket.data.room = roomId;
  socket.data.pendingRoom = null;
  socket.data.name = name;
  socket.join(roomId);

  socket.emit("joined", {
    selfId: socket.id,
    chat: outcome.chat,
    maxPeers: outcome.maxPeers,
  });

  // The media credential, issued here and only here. Someone left knocking in
  // the waiting room never reaches this line, so they never get a token — the
  // lobby is enforced by the SFU refusing them, not by the client behaving.
  livekit
    ?.issueToken(roomId, socket.id, name)
    .then((creds) => creds && socket.emit("livekit", creds));

  broadcast.roomState(roomId, outcome.snapshot);
  await broadcast.system(registry, roomId, `${name} joined`);
  console.log(`[join] ${name} (${socket.id}) -> ${roomId}`);
}

export async function join({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const { roomId, name, media } = data;

  const decision = await registry.withRoom(roomId, (room) => {
    if (room.isFull) return { verdict: "full" };
    if (room.requiresApproval(socket.id)) {
      room.knock(socket.id, name, media);
      return { verdict: "knock", snapshot: room.snapshot() };
    }
    return { verdict: "admit" };
  });

  if (decision.verdict === "full") {
    socket.emit("room-full");
    return;
  }

  if (decision.verdict === "knock") {
    socket.data.pendingRoom = roomId;
    socket.data.name = name;
    socket.emit("waiting");
    broadcast.roomState(roomId, decision.snapshot); // the host's knock queue
    console.log(`[knock] ${name} (${socket.id}) -> ${roomId}`);
    return;
  }

  await admit({ socket, roomId, name, media, deps });
}

export async function leave({ socket, deps }) {
  const { registry, broadcast } = deps;

  const roomId = socket.data.room || socket.data.pendingRoom;
  if (!roomId) return;

  const result = await registry.withRoom(roomId, (room) => {
    const { member, newHostId, empty } = room.removeMember(socket.id);
    return {
      member,
      newHostId,
      empty,
      newHostName: newHostId ? room.members.get(newHostId)?.name : null,
      snapshot: room.snapshot(),
    };
  });

  if (result.empty) {
    await registry.delete(roomId);
  } else {
    if (result.newHostId) {
      await broadcast.system(registry, roomId, `${result.newHostName} is now the host`);
    }
    if (result.member) await broadcast.system(registry, roomId, `${result.member.name} left`);
    broadcast.roomState(roomId, result.snapshot);
  }

  socket.data.room = null;
  socket.data.pendingRoom = null;
  console.log(`[leave] ${socket.id} <- ${roomId}`);
}

// Mute, camera, presenting, hand. Without this nobody can tell you're muted —
// they just hear silence and can't distinguish it from a dead connection.
export async function updateState({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const roomId = socket.data.room;
  if (!roomId) return;

  const snapshot = await registry.withRoom(roomId, (room) =>
    room.patchState(socket.id, data) ? room.snapshot() : null
  );

  if (snapshot) broadcast.roomState(roomId, snapshot);
}

export async function react({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const roomId = socket.data.room;
  if (!roomId) return;

  const room = await registry.get(roomId);
  if (!room?.has(socket.id)) return;

  broadcast.toRoom(roomId, "reaction", {
    id: socket.id,
    name: socket.data.name,
    emoji: data.emoji,
    ts: Date.now(),
  });
}
