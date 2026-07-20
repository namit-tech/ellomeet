import { io } from "socket.io-client";

/**
 * SignalingClient — the transport. Wraps the socket so nothing above this layer
 * imports socket.io or knows an event name as a bare string.
 *
 * The URL:
 *   1. VITE_SIGNALING_URL (build-time) always wins.
 *   2. In production, the same origin — nginx proxies /socket.io to the server.
 *   3. In dev, the same host on port 3001.
 */
const url =
  import.meta.env.VITE_SIGNALING_URL ||
  (import.meta.env.PROD
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:3001`);

export class SignalingClient {
  constructor() {
    this.socket = io(url, { autoConnect: false });
  }

  connect() {
    if (!this.socket.connected) this.socket.connect();
    return this;
  }

  disconnect() {
    this.socket.disconnect();
  }

  get id() {
    return this.socket.id;
  }

  /**
   * Subscribe to a map of event -> handler. Returns a single unsubscribe
   * function, so a caller can never leak half its listeners.
   */
  on(handlers) {
    for (const [event, handler] of Object.entries(handlers)) {
      this.socket.on(event, handler);
    }
    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        this.socket.off(event, handler);
      }
    };
  }

  // --- outbound: the client half of the protocol in validation/schemas.js ---

  join(roomId, name, media) {
    this.socket.emit("join", { roomId, name, media });
  }

  leave() {
    this.socket.emit("leave");
  }

  offer(to, sdp) {
    this.socket.emit("offer", { to, sdp });
  }

  answer(to, sdp) {
    this.socket.emit("answer", { to, sdp });
  }

  iceCandidate(to, candidate) {
    this.socket.emit("ice-candidate", { to, candidate });
  }

  // Mute, camera, presenting, hand. Sending this is what makes your state
  // visible to everyone else — silence alone is indistinguishable from a drop.
  updateState(patch) {
    this.socket.emit("state", patch);
  }

  chat(text) {
    this.socket.emit("chat", { text });
  }

  react(emoji) {
    this.socket.emit("reaction", { emoji });
  }

  host = {
    mute: (id) => this.socket.emit("host:mute", { id }),
    remove: (id) => this.socket.emit("host:remove", { id }),
    setLocked: (locked) => this.socket.emit("host:lock", { locked }),
    admit: (id) => this.socket.emit("host:admit", { id }),
    deny: (id) => this.socket.emit("host:deny", { id }),
    end: () => this.socket.emit("host:end"),
  };
}
