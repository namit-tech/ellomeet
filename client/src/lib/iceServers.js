// Fallback ICE servers used only until the signaling server sends the real
// list (which includes TURN). The server keeps the Metered API key secret and
// emits fresh TURN credentials over the socket — see useWebRTC's "ice-servers"
// handler. These STUN servers are enough for same-network testing on their own.
export const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
