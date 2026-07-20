import { io } from "socket.io-client";

// Minimal assertion + client helpers shared by the suites. No test framework:
// these drive real socket clients against a real server, which is the only way
// to prove the protocol actually behaves.

export function createReporter(suite) {
  let failures = 0;
  console.log(`\n— ${suite} —`);

  return {
    check(label, condition, extra = "") {
      console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
      if (!condition) failures++;
    },
    get failures() {
      return failures;
    },
  };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A socket that records everything the server sends it, so assertions can look
// back at what arrived rather than racing callbacks.
export function connect(url) {
  const socket = io(url, { transports: ["websocket"] });

  socket.state = { room: null, chat: [], events: [], rejected: [] };
  socket.on("room-state", (s) => (socket.state.room = s));
  socket.on("chat", (m) => socket.state.chat.push(m));
  socket.on("invalid-payload", (p) => socket.state.rejected.push(p));

  for (const event of [
    "joined", "waiting", "denied", "removed", "meeting-ended",
    "room-full", "force-mute", "peer-joined", "peer-left", "reaction",
  ]) {
    socket.on(event, (payload) => socket.state.events.push({ event, payload }));
  }

  return socket;
}

export const eventsOf = (socket, name) =>
  socket.state.events.filter((e) => e.event === name);

export const self = (socket) =>
  socket.state.room?.participants.find((p) => p.id === socket.id);

export const wasRejected = (socket, event) =>
  socket.state.rejected.some((r) => r.event === event);
