/**
 * The room state machine — the only place that decides who is in a meeting,
 * who runs it, and who is allowed in.
 *
 * Deliberately free of Socket.IO: no `io`, no `socket`, no emit. It takes ids
 * and returns facts, which is what makes the rules that actually bite (host
 * transfer on disconnect, the capacity cap, admitting someone into a room that
 * just emptied) testable without standing up a server.
 *
 * It is also free of storage. A Room is built from a plain state object and can
 * serialise back to one (`fromState` / `toState`), so the same rules run
 * whether that state lives in this process's memory or in Valkey shared by a
 * dozen instances. All mutation goes through `store.withRoom`, which loads,
 * applies, and persists as one step — see services/store/.
 */

/**
 * Room capacity.
 *
 * 20 is safe now only because media goes through the SFU. It was 4 while
 * clients meshed, because a mesh has every participant send to every other one
 * — at 20 that is 19 outbound streams each, roughly 23 Mbps upload and 19
 * encoders per person. The cap was the thing standing between users and a call
 * that connects and then falls over.
 *
 * Going much past 20 is a per-room UI and downlink question rather than a
 * server one; see PLAN.md §3.
 */
export const DEFAULT_MAX_PEERS = Number(process.env.MAX_PEERS || 20);
const CHAT_HISTORY = 200;

export class Room {
  constructor(id, maxPeers = DEFAULT_MAX_PEERS) {
    this.id = id;
    this.maxPeers = maxPeers;
    this.hostId = null;
    this.locked = false;
    this.members = new Map(); // id -> { name, audio, video, sharing, hand }
    this.waiting = new Map(); // id -> { name, media }  (knocking)
    // Approved by the host but not yet re-joined. Admission is a handshake in a
    // cluster (see host.controller.js), so there is a moment where someone is
    // allowed in but has not come back yet. Without this they would knock again
    // and wait forever.
    this.approved = new Set();
    // Co-hosts. Like Zoom: the host can promote members to share the moderation
    // load — admitting from the lobby, muting, removing, locking — while the
    // host alone keeps the powers that reshape the room itself (promote/demote,
    // end for all).
    this.coHosts = new Set();
    this.chat = [];
  }

  /**
   * Rehydrate from storage.
   *
   * Members and waiting are stored as entry ARRAYS, not objects: Map preserves
   * insertion order and the host-transfer rule depends on it ("whoever has been
   * here longest"). A plain object would not survive a round trip with that
   * order guaranteed for all key shapes.
   */
  static fromState(id, state, maxPeers = DEFAULT_MAX_PEERS) {
    const room = new Room(id, maxPeers);
    if (!state) return room;
    room.hostId = state.hostId ?? null;
    room.locked = !!state.locked;
    room.members = new Map(state.members || []);
    room.waiting = new Map(state.waiting || []);
    room.approved = new Set(state.approved || []);
    room.coHosts = new Set(state.coHosts || []);
    room.chat = state.chat || [];
    return room;
  }

  toState() {
    return {
      hostId: this.hostId,
      locked: this.locked,
      members: [...this.members.entries()],
      waiting: [...this.waiting.entries()],
      approved: [...this.approved],
      coHosts: [...this.coHosts],
      chat: this.chat,
    };
  }

  get size() {
    return this.members.size;
  }

  get isFull() {
    return this.members.size >= this.maxPeers;
  }

  get isEmpty() {
    return this.members.size === 0;
  }

  has(id) {
    return this.members.has(id);
  }

  isHost(id) {
    return this.hostId === id;
  }

  isCoHost(id) {
    return this.coHosts.has(id);
  }

  // Host or co-host. This is the check that gates moderation — admitting from
  // the lobby, muting, removing, locking. The stricter isHost still gates the
  // things only the owner may do.
  isModerator(id) {
    return this.hostId === id || this.coHosts.has(id);
  }

  /** Host-only. No-op on the host itself or on a non-member. */
  promote(id) {
    if (id && id !== this.hostId && this.members.has(id)) this.coHosts.add(id);
  }

  demote(id) {
    this.coHosts.delete(id);
  }

  // An empty room can't be locked against its own first arrival — otherwise a
  // locked meeting whose host dropped out could never be entered by anyone.
  requiresApproval(id) {
    // Someone the host already waved through skips the lobby on their way back.
    if (id && this.approved.has(id)) return false;
    return this.locked && this.members.size > 0;
  }

  approve(id) {
    this.approved.add(id);
  }

  addMember(id, name, media = {}) {
    if (this.isFull) return false;

    this.waiting.delete(id);
    this.approved.delete(id);

    // First one in owns the room; also re-elect if the recorded host is gone.
    if (!this.hostId || !this.members.has(this.hostId)) this.hostId = id;

    this.members.set(id, {
      name,
      audio: media.audio ?? true,
      video: media.video ?? true,
      sharing: false,
      hand: false,
    });
    return true;
  }

  /**
   * @returns {{ member: object|null, newHostId: string|null, empty: boolean }}
   *   newHostId is set only when this removal forced the host to change.
   */
  removeMember(id) {
    const member = this.members.get(id) || null;
    this.members.delete(id);
    this.waiting.delete(id);
    this.approved.delete(id);
    this.coHosts.delete(id);

    let newHostId = null;
    if (this.hostId === id && !this.isEmpty) {
      // The host left. Hand the room to a co-host if there is one (Zoom's rule),
      // otherwise to whoever has been here longest. Either way they stop being a
      // co-host, since they are now the host.
      const nextCoHost = [...this.coHosts].find((cid) => this.members.has(cid));
      this.hostId = nextCoHost || this.members.keys().next().value;
      this.coHosts.delete(this.hostId);
      newHostId = this.hostId;
    }

    return { member, newHostId, empty: this.isEmpty };
  }

  patchState(id, patch) {
    const member = this.members.get(id);
    if (!member) return false;

    for (const key of ["audio", "video", "sharing", "hand"]) {
      if (typeof patch[key] === "boolean") member[key] = patch[key];
    }
    return true;
  }

  // --- waiting room ---------------------------------------------------------

  knock(id, name, media) {
    this.waiting.set(id, { name, media });
  }

  takeWaiting(id) {
    const entry = this.waiting.get(id) || null;
    this.waiting.delete(id);
    return entry;
  }

  drainWaiting() {
    const all = [...this.waiting.entries()];
    this.waiting.clear();
    return all;
  }

  setLocked(locked) {
    this.locked = locked;
  }

  // --- chat -----------------------------------------------------------------

  addChat(message) {
    this.chat.push(message);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    return message;
  }

  // --- projections ----------------------------------------------------------

  roster() {
    return [...this.members.entries()].map(([id, m]) => ({
      id,
      name: m.name,
      audio: m.audio,
      video: m.video,
      sharing: m.sharing,
      hand: m.hand,
      isHost: id === this.hostId,
      isCoHost: this.coHosts.has(id),
    }));
  }

  // The full state every client renders from. Small enough (<= maxPeers) that
  // sending a snapshot beats diffing, and it can't drift out of sync.
  snapshot() {
    return {
      hostId: this.hostId,
      locked: this.locked,
      participants: this.roster(),
      waiting: [...this.waiting.entries()].map(([id, w]) => ({ id, name: w.name })),
    };
  }
}

/**
 * The registry is a thin facade over whichever store is configured.
 *
 * Everything is async because the state may be a network hop away. The shape
 * that matters is `withRoom`: load, mutate, persist — one indivisible step. Any
 * code path that reads a room, decides something, and then writes MUST do it
 * inside a single `withRoom` callback, or two instances can interleave and
 * produce the bugs this whole layer exists to prevent (a 21st participant, two
 * hosts).
 */
export class RoomRegistry {
  constructor(store) {
    this.store = store;
  }

  /** Mutating access. `fn` must be synchronous — see the stores. */
  withRoom(id, fn) {
    return this.store.withRoom(id, fn);
  }

  /** Read-only. Null when the room does not exist. */
  get(id) {
    return this.store.readRoom(id);
  }

  delete(id) {
    return this.store.deleteRoom(id);
  }
}
