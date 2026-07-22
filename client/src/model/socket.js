import { io } from "socket.io-client";

// The signaling server URL.
//   1. VITE_SIGNALING_URL (build-time env) always wins if set.
//   2. In production (built app), connect to the SAME origin — nginx proxies
//      /socket.io through to the Node server, so no port is needed.
//   3. In dev, fall back to the same host on port 3001.
const url =
  import.meta.env.VITE_SIGNALING_URL ||
  (import.meta.env.PROD
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:3001`);

// Create a single lazily-connected socket shared across the app.
export const socket = io(url, { autoConnect: false });

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
