import Redis from "ioredis";
import { Room, DEFAULT_MAX_PEERS } from "../room.service.js";

/**
 * Room storage shared by every server instance, over the Redis protocol
 * (Valkey or Redis — identical wire format, so either works).
 *
 * WHY A LOCK. Room mutations are read-modify-write: "add this member unless the
 * room is full", "hand the host role to whoever is next". Two instances doing
 * that concurrently on the same room would each read the old state and one
 * would overwrite the other — a 20th person admitted to a 20-person room, or
 * two hosts. So each mutation takes a short per-room lock first.
 *
 * The lock is intentionally crude: SET NX with a TTL, spin briefly, give up.
 * Rooms are low-contention (a handful of events per second at most) and every
 * critical section is a few microseconds of synchronous work, so contention is
 * rare and a lost lock is self-healing via the TTL. A full Redlock would be
 * ceremony without benefit at this scale — but note this is NOT safe against a
 * process pausing mid-section for longer than LOCK_TTL_MS.
 */

const LOCK_TTL_MS = 5000; // generous: the critical section is microseconds
const LOCK_RETRY_MS = 20;
const LOCK_MAX_WAIT_MS = 2000;

const key = (id) => `room:${id}`;
const lockKey = (id) => `lock:room:${id}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createRedisStore({
  url = process.env.REDIS_URL,
  maxPeers = DEFAULT_MAX_PEERS,
} = {}) {
  const redis = new Redis(url, { maxRetriesPerRequest: null });

  redis.on("error", (err) => console.error("[redis]", err.message));

  // Release only our own lock. Deleting unconditionally could drop a lock that
  // had already expired and been taken by someone else.
  redis.defineCommand("releaseLock", {
    numberOfKeys: 1,
    lua: `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `,
  });

  async function acquire(id) {
    const token = `${process.pid}-${Date.now()}-${Math.random()}`;
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;

    for (;;) {
      const ok = await redis.set(lockKey(id), token, "PX", LOCK_TTL_MS, "NX");
      if (ok) return token;
      if (Date.now() > deadline) {
        // Proceeding unlocked is worse than failing loudly: it is exactly the
        // double-admit this lock exists to prevent.
        throw new Error(`Timed out waiting for room lock: ${id}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }

  async function load(id) {
    const raw = await redis.get(key(id));
    return raw ? Room.fromState(id, JSON.parse(raw), maxPeers) : new Room(id, maxPeers);
  }

  return {
    kind: "redis",

    async withRoom(id, fn) {
      const token = await acquire(id);
      try {
        const room = await load(id);
        const result = fn(room);
        await redis.set(key(id), JSON.stringify(room.toState()));
        return result;
      } finally {
        await redis.releaseLock(lockKey(id), token).catch(() => {});
      }
    },

    async readRoom(id) {
      const raw = await redis.get(key(id));
      return raw ? Room.fromState(id, JSON.parse(raw), maxPeers) : null;
    },

    async deleteRoom(id) {
      await redis.del(key(id));
    },

    async close() {
      await redis.quit().catch(() => {});
    },

    /** Shared by the socket.io adapter so we run one connection pool, not two. */
    client: redis,
  };
}
