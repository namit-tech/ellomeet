/**
 * Joining, leaving, presence state, reactions.
 *
 * Controllers are thin on purpose: the payload is already validated, the rules
 * live in room.service.js, and the wire lives in broadcast.service.js.
 */

// Shared by `join` and by the host admitting someone from the waiting room.
export function admit({ socket, room, name, media, deps }) {
  const { broadcast } = deps;

  if (room.isFull) {
    socket.emit("room-full");
    return;
  }

  socket.data.room = room.id;
  socket.data.name = name;
  socket.join(room.id);

  // Read the peer list BEFORE adding the newcomer: whoever joins later is the
  // one that sends the offers, which is how we avoid glare (both sides
  // offering at once).
  const peers = room.peerList();

  socket.emit("joined", {
    selfId: socket.id,
    peers,
    chat: room.chat,
    maxPeers: room.maxPeers,
  });

  room.addMember(socket.id, name, media);

  // Existing members now expect an offer from this socket.
  socket.to(room.id).emit("peer-joined", { id: socket.id, name });

  broadcast.roomState(room);
  broadcast.system(room, `${name} joined`);
  console.log(`[join] ${name} (${socket.id}) -> ${room.id} (${room.size} in room)`);
}

export function join({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const { roomId, name, media } = data;

  const room = registry.ensure(roomId);

  if (room.isFull) {
    socket.emit("room-full");
    return;
  }

  if (room.requiresApproval()) {
    socket.data.pendingRoom = roomId;
    socket.data.name = name;
    room.knock(socket.id, name, media);

    socket.emit("waiting");
    broadcast.roomState(room); // the host's knock queue
    console.log(`[knock] ${name} (${socket.id}) -> ${roomId}`);
    return;
  }

  admit({ socket, room, name, media, deps });
}

export function leave({ socket, deps }) {
  const { registry, broadcast } = deps;

  const roomId = socket.data.room || socket.data.pendingRoom;
  const room = roomId ? registry.get(roomId) : null;
  if (!room) return;

  const { member, newHostId, empty } = room.removeMember(socket.id);

  // Tell the others to tear down the peer connection either way.
  socket.to(room.id).emit("peer-left", { id: socket.id });

  if (empty) {
    registry.delete(room.id);
  } else {
    if (newHostId) {
      broadcast.system(room, `${room.members.get(newHostId).name} is now the host`);
    }
    if (member) broadcast.system(room, `${member.name} left`);
    broadcast.roomState(room);
  }

  socket.data.room = null;
  socket.data.pendingRoom = null;
  console.log(`[leave] ${socket.id} <- ${roomId}`);
}

// Mute, camera, presenting, hand. Without this nobody can tell you're muted —
// they just hear silence and can't distinguish it from a dead connection.
export function updateState({ socket, data, deps }) {
  const { registry, broadcast } = deps;

  const room = registry.get(socket.data.room);
  if (!room || !room.patchState(socket.id, data)) return;

  broadcast.roomState(room);
}

export function react({ socket, data, deps }) {
  const { registry, broadcast } = deps;

  const room = registry.get(socket.data.room);
  if (!room || !room.has(socket.id)) return;

  broadcast.toRoom(room, "reaction", {
    id: socket.id,
    name: socket.data.name,
    emoji: data.emoji,
    ts: Date.now(),
  });
}
