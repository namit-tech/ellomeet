import { admit } from "./room.controller.js";

/**
 * Moderator controls. Every handler runs through `asHost` first — authority is
 * checked on the server, never assumed from the fact that a client rendered
 * the button.
 */
function asHost({ socket, registry }) {
  const room = registry.get(socket.data.room);
  if (!room || !room.isHost(socket.id)) return null;
  return room;
}

// We cannot reach into someone's microphone from here. We ask, their client
// mutes itself, and it reports the new state back to the room.
export function mute({ socket, data, deps }) {
  const room = asHost({ socket, registry: deps.registry });
  if (!room || !room.has(data.id)) return;

  deps.broadcast.toPeer(data.id, "force-mute", { by: socket.data.name });
}

export function remove({ socket, data, deps }) {
  const { broadcast } = deps;
  const room = asHost({ socket, registry: deps.registry });
  if (!room || data.id === socket.id) return;

  const { member } = room.removeMember(data.id);
  if (!member) return;

  broadcast.toPeer(data.id, "removed", { by: socket.data.name });
  broadcast.evict(data.id, room.id); // stop their traffic immediately
  broadcast.toRoom(room, "peer-left", { id: data.id });
  broadcast.roomState(room);
  broadcast.system(room, `${member.name} was removed`);
}

export function lock({ socket, data, deps }) {
  const { broadcast } = deps;
  const room = asHost({ socket, registry: deps.registry });
  if (!room) return;

  room.setLocked(data.locked);

  // Unlocking lets everyone currently knocking straight in — leaving them
  // stuck in a lobby that no longer exists would be a trap.
  if (!room.locked) {
    for (const [id, entry] of room.drainWaiting()) {
      const waitingSocket = broadcast.socketFor(id);
      if (waitingSocket) {
        admit({ socket: waitingSocket, room, name: entry.name, media: entry.media, deps });
      }
    }
  }

  broadcast.roomState(room);
  broadcast.system(room, room.locked ? "Meeting locked" : "Meeting unlocked");
}

export function admitOne({ socket, data, deps }) {
  const { broadcast } = deps;
  const room = asHost({ socket, registry: deps.registry });
  if (!room) return;

  const entry = room.takeWaiting(data.id);
  const waitingSocket = broadcast.socketFor(data.id);
  if (!entry || !waitingSocket) return;

  admit({ socket: waitingSocket, room, name: entry.name, media: entry.media, deps });
}

export function deny({ socket, data, deps }) {
  const { broadcast } = deps;
  const room = asHost({ socket, registry: deps.registry });
  if (!room || !room.takeWaiting(data.id)) return;

  broadcast.toPeer(data.id, "denied");
  broadcast.roomState(room);
}

export function end({ socket, deps }) {
  const { registry, broadcast } = deps;
  const room = asHost({ socket, registry });
  if (!room) return;

  broadcast.toRoom(room, "meeting-ended", { by: socket.data.name });
  // People still in the lobby are waiting for a meeting that no longer exists.
  for (const [id] of room.drainWaiting()) {
    broadcast.toPeer(id, "meeting-ended", {});
  }

  registry.delete(room.id);
  console.log(`[end] ${room.id} ended by host`);
}
