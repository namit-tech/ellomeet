import { Room, DEFAULT_MAX_PEERS } from "../room.service.js";

/**
 * Single-process room storage.
 *
 * The default, and correct for one server. `withRoom` needs no locking here:
 * Node runs one thing at a time, and the callback is synchronous, so a
 * load-modify-save can never interleave with another.
 *
 * Same interface as redis.store.js, so the composition root can swap them
 * without anything above noticing.
 */
export function createMemoryStore({ maxPeers = DEFAULT_MAX_PEERS } = {}) {
  const rooms = new Map(); // id -> state

  return {
    kind: "memory",

    /**
     * Load a room, hand it to `fn`, persist whatever `fn` did, return what
     * `fn` returned. The room is created if absent.
     *
     * `fn` MUST be synchronous. Awaiting inside it would open the exact
     * interleaving window this pattern exists to close.
     */
    async withRoom(id, fn) {
      const room = rooms.has(id)
        ? Room.fromState(id, rooms.get(id), maxPeers)
        : new Room(id, maxPeers);

      const result = fn(room);
      rooms.set(id, room.toState());
      return result;
    },

    /** Read-only peek. Returns null rather than creating the room. */
    async readRoom(id) {
      const state = rooms.get(id);
      return state ? Room.fromState(id, state, maxPeers) : null;
    },

    async deleteRoom(id) {
      rooms.delete(id);
    },

    async close() {},
  };
}
