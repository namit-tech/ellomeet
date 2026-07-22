/**
 * The only module that talks to Socket.IO's emit side.
 *
 * Controllers describe *what* should be published; this decides how it reaches
 * the wire. Keeping it in one place is what lets room.service.js stay pure.
 *
 * CLUSTER SAFETY. With the Redis adapter, `io.to(...).emit(...)` reaches
 * clients on every instance — but the socket *objects* only exist on the
 * instance holding that connection. So anything that manipulates a specific
 * socket (making it leave a room, disconnecting it) has to go through the
 * adapter's cluster-wide helpers rather than `io.sockets.sockets.get(id)`,
 * which sees local connections only and silently no-ops for everyone else.
 */
export function createBroadcaster(io) {
  return {
    // Everyone re-renders from this snapshot — see Room#snapshot. Takes the
    // snapshot rather than the room, because the caller produced it inside the
    // same transaction that made the change.
    roomState(roomId, snapshot) {
      io.to(roomId).emit("room-state", snapshot);
    },

    // Joins, leaves, locks: recorded in the chat history so a late joiner sees
    // the context, not just an empty transcript.
    async system(registry, roomId, text) {
      const message = await registry.withRoom(roomId, (room) =>
        room.addChat({ id: "system", name: "", text, ts: Date.now(), system: true })
      );
      io.to(roomId).emit("chat", message);
    },

    async chat(registry, roomId, message) {
      const stored = await registry.withRoom(roomId, (room) => room.addChat(message));
      io.to(roomId).emit("chat", stored);
    },

    toRoom(roomId, event, payload) {
      io.to(roomId).emit(event, payload);
    },

    toPeer(id, event, payload) {
      io.to(id).emit(event, payload);
    },

    // Force a socket out of the room's broadcast group (used when the host
    // removes someone — they must stop receiving room traffic immediately).
    // socketsLeave works across the cluster; socket.leave() would not.
    async evict(id, roomId) {
      await io.in(id).socketsLeave(roomId);
    },
  };
}
