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
  const issued = new Map(); // code -> expiry ms (freshly minted, not yet used)

  return {
    kind: "memory",

    /**
     * Remember a freshly minted code so its FIRST join is allowed to create the
     * room. Everything else that reaches join without an active room and without
     * a live reservation is rejected as "not found" — that is what stops someone
     * typing `001` from conjuring a room. `meta` carries the passcode hash the
     * new room should adopt.
     */
    async issueCode(code, { ttlMs, passcodeHash = null }) {
      issued.set(code, { expiry: Date.now() + ttlMs, passcodeHash });
    },

    /**
     * The reservation for this code, or null. Non-consuming on purpose: once the
     * room exists the existence check takes over, and leaving the reservation
     * valid for its TTL lets two people open the same fresh link at once without
     * the second being wrongly rejected. Expired entries are swept on read.
     */
    async claimCode(code) {
      const rec = issued.get(code);
      if (!rec) return null;
      if (rec.expiry <= Date.now()) {
        issued.delete(code);
        return null;
      }
      return { passcodeHash: rec.passcodeHash };
    },

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
