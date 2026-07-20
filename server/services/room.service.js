/**
 * The room state machine — the only place that decides who is in a meeting,
 * who runs it, and who is allowed in.
 *
 * Deliberately free of Socket.IO: no `io`, no `socket`, no emit. It takes ids
 * and returns facts, which is what makes the rules that actually bite (host
 * transfer on disconnect, the mesh capacity cap, admitting someone into a room
 * that just emptied) testable without standing up a server.
 */

export const DEFAULT_MAX_PEERS = Number(process.env.MAX_PEERS || 4);
const CHAT_HISTORY = 200;

export class Room {
  constructor(id, maxPeers = DEFAULT_MAX_PEERS) {
    this.id = id;
    this.maxPeers = maxPeers;
    this.hostId = null;
    this.locked = false;
    this.members = new Map(); // id -> { name, audio, video, sharing, hand }
    this.waiting = new Map(); // id -> { name, media }  (knocking)
    this.chat = [];
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

  // An empty room can't be locked against its own first arrival — otherwise a
  // locked meeting whose host dropped out could never be entered by anyone.
  requiresApproval() {
    return this.locked && this.members.size > 0;
  }

  // Whoever is already here. Must be read BEFORE addMember, because the
  // newcomer is the one that sends the offers (the anti-glare rule).
  peerList() {
    return [...this.members.entries()].map(([id, m]) => ({ id, name: m.name }));
  }

  addMember(id, name, media = {}) {
    if (this.isFull) return false;

    this.waiting.delete(id);

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

    let newHostId = null;
    if (this.hostId === id && !this.isEmpty) {
      // Hand the room to whoever has been here longest (Map keeps insertion order).
      this.hostId = this.members.keys().next().value;
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

export class RoomRegistry {
  constructor(maxPeers = DEFAULT_MAX_PEERS) {
    this.maxPeers = maxPeers;
    this.rooms = new Map();
  }

  get(id) {
    return this.rooms.get(id) || null;
  }

  ensure(id) {
    if (!this.rooms.has(id)) this.rooms.set(id, new Room(id, this.maxPeers));
    return this.rooms.get(id);
  }

  delete(id) {
    this.rooms.delete(id);
  }
}
