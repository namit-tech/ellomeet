/**
 * The only module that talks to Socket.IO's emit side.
 *
 * Controllers describe *what* should be published; this decides how it reaches
 * the wire. Keeping it in one place is what lets room.service.js stay pure.
 */
export function createBroadcaster(io) {
  return {
    // Everyone re-renders from this snapshot — see Room#snapshot.
    roomState(room) {
      io.to(room.id).emit("room-state", room.snapshot());
    },

    // Joins, leaves, locks: recorded in the chat history so a late joiner sees
    // the context, not just an empty transcript.
    system(room, text) {
      const message = room.addChat({
        id: "system",
        name: "",
        text,
        ts: Date.now(),
        system: true,
      });
      io.to(room.id).emit("chat", message);
    },

    chat(room, message) {
      io.to(room.id).emit("chat", room.addChat(message));
    },

    toRoom(room, event, payload) {
      io.to(room.id).emit(event, payload);
    },

    toPeer(id, event, payload) {
      io.to(id).emit(event, payload);
    },

    // Force a socket out of the room's broadcast group (used when the host
    // removes someone — they must stop receiving room traffic immediately).
    evict(id, roomId) {
      const socket = io.sockets.sockets.get(id);
      if (!socket) return;
      socket.leave(roomId);
      socket.data.room = null;
    },

    socketFor(id) {
      return io.sockets.sockets.get(id) || null;
    },
  };
}
