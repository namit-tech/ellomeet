/**
 * Moderator controls. Every handler re-checks authority against stored state —
 * never assumed from the fact that a client rendered the button.
 *
 * ADMISSION IN A CLUSTER. Letting someone in used to mean grabbing their socket
 * object and calling admit() on it. That only works while every connection
 * lives in this process: `io.sockets.sockets.get(id)` sees local sockets and
 * silently finds nothing for anyone connected to a sibling instance, so a host
 * on server A could not admit a guest on server B.
 *
 * So admission is a two-step handshake instead. The host's instance marks the
 * guest approved in shared state and emits "admitted" to them; the guest's
 * client re-sends `join`, which runs on whichever instance actually holds that
 * connection and can set up its socket properly. Slightly more chatter, and the
 * only version that works on more than one machine.
 */

// Strictly the room owner. Gates the powers that reshape the room: promoting
// and demoting co-hosts, ending the meeting for everyone.
async function asHost({ socket, registry }) {
  const roomId = socket.data.room;
  if (!roomId) return null;
  const room = await registry.get(roomId);
  if (!room || !room.isHost(socket.id)) return null;
  return room;
}

// Host or co-host. Gates day-to-day moderation: admitting from the lobby,
// muting, removing, locking.
async function asModerator({ socket, registry }) {
  const roomId = socket.data.room;
  if (!roomId) return null;
  const room = await registry.get(roomId);
  if (!room || !room.isModerator(socket.id)) return null;
  return room;
}

// We cannot reach into someone's microphone from here. We ask, their client
// mutes itself, and it reports the new state back to the room.
export async function mute({ socket, data, deps }) {
  const room = await asModerator({ socket, registry: deps.registry });
  // A co-host cannot mute the host.
  if (!room || !room.has(data.id) || room.isHost(data.id)) return;

  deps.broadcast.toPeer(data.id, "force-mute", { by: socket.data.name });
}

export async function remove({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const room = await asModerator({ socket, registry });
  // Never remove yourself, and a co-host can't remove the host.
  if (!room || data.id === socket.id || room.isHost(data.id)) return;

  const result = await registry.withRoom(room.id, (r) => {
    const { member } = r.removeMember(data.id);
    return member ? { member, snapshot: r.snapshot() } : null;
  });
  if (!result) return;

  broadcast.toPeer(data.id, "removed", { by: socket.data.name });
  await broadcast.evict(data.id, room.id); // stop their traffic immediately
  broadcast.roomState(room.id, result.snapshot);
  await broadcast.system(registry, room.id, `${result.member.name} was removed`);
}

export async function lock({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const room = await asModerator({ socket, registry });
  if (!room) return;

  const result = await registry.withRoom(room.id, (r) => {
    r.setLocked(data.locked);

    // Unlocking lets everyone currently knocking straight in — leaving them
    // stuck in a lobby that no longer exists would be a trap.
    const freed = r.locked ? [] : r.drainWaiting().map(([id]) => id);
    for (const id of freed) r.approve(id);

    return { locked: r.locked, freed, snapshot: r.snapshot() };
  });

  for (const id of result.freed) broadcast.toPeer(id, "admitted", {});

  broadcast.roomState(room.id, result.snapshot);
  await broadcast.system(registry, room.id, result.locked ? "Meeting locked" : "Meeting unlocked");
}

export async function admitOne({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const room = await asModerator({ socket, registry });
  if (!room) return;

  const result = await registry.withRoom(room.id, (r) => {
    const entry = r.takeWaiting(data.id);
    if (!entry) return null;
    r.approve(data.id);
    return { snapshot: r.snapshot() };
  });
  if (!result) return;

  broadcast.toPeer(data.id, "admitted", {});
  broadcast.roomState(room.id, result.snapshot);
}

export async function deny({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const room = await asModerator({ socket, registry });
  if (!room) return;

  const snapshot = await registry.withRoom(room.id, (r) =>
    r.takeWaiting(data.id) ? r.snapshot() : null
  );
  if (!snapshot) return;

  broadcast.toPeer(data.id, "denied");
  broadcast.roomState(room.id, snapshot);
}

// Promote a member to co-host, or demote them. Host only — a co-host cannot
// create more co-hosts, which is what keeps the owner in ultimate control.
export async function promote({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const room = await asHost({ socket, registry });
  if (!room || !room.has(data.id) || data.id === socket.id) return;

  const snapshot = await registry.withRoom(room.id, (r) => {
    r.promote(data.id);
    return r.snapshot();
  });

  broadcast.toPeer(data.id, "role-changed", { coHost: true, by: socket.data.name });
  broadcast.roomState(room.id, snapshot);
  await broadcast.system(registry, room.id, `${room.members.get(data.id)?.name} is now a co-host`);
}

export async function demote({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const room = await asHost({ socket, registry });
  if (!room || !room.has(data.id)) return;

  const snapshot = await registry.withRoom(room.id, (r) => {
    r.demote(data.id);
    return r.snapshot();
  });

  broadcast.toPeer(data.id, "role-changed", { coHost: false, by: socket.data.name });
  broadcast.roomState(room.id, snapshot);
}

export async function end({ socket, deps }) {
  const { registry, broadcast } = deps;
  const room = await asHost({ socket, registry });
  if (!room) return;

  const waiting = await registry.withRoom(room.id, (r) => r.drainWaiting().map(([id]) => id));

  broadcast.toRoom(room.id, "meeting-ended", { by: socket.data.name });
  // People still in the lobby are waiting for a meeting that no longer exists.
  for (const id of waiting) broadcast.toPeer(id, "meeting-ended", {});

  await registry.delete(room.id);
  console.log(`[end] ${room.id} ended by host`);
}
