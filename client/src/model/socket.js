import { io } from "socket.io-client";

// The signaling server URL.
//   1. VITE_SIGNALING_URL (build-time env) always wins — set in .env.production,
//      because the API is on its own subdomain and the static host does not
//      proxy /socket.io/ at all.
//   2. Same origin, only as a last resort. This is a trap when the app and the
//      API are on different hosts: the socket quietly fails to connect and the
//      call sits on a black screen, so it warns rather than failing silently.
//   3. In dev, the same host on port 3001.
const configured = import.meta.env.VITE_SIGNALING_URL;

if (import.meta.env.PROD && !configured) {
  console.error(
    "VITE_SIGNALING_URL was not set at build time. Falling back to this " +
      "origin, which only works if the API is served from the same host."
  );
}

const url =
  configured ||
  (import.meta.env.PROD
    ? window.location.origin
    : `${window.location.protocol}//${window.location.hostname}:3001`);

// The API base, exported so the landing page can mint a room code over HTTP
// before any socket exists.
export const API_URL = url;

// Ask the server for a fresh, unguessable room. The client no longer invents
// codes (that let anyone conjure `001`); the server mints them, scoped to a
// tenant and optionally guarded by a passcode.
//
// Returns { tenant, code, roomId, hasPasscode }: `roomId` is the composite key
// you join with, `tenant`/`code` are for building the /t/<tenant>/room/<code>
// URL.
export async function createRoom({ tenant, passcode } = {}) {
  const res = await fetch(`${url}/rooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant, passcode }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status}`);
  return res.json();
}

// Create a single lazily-connected socket shared across the app.
export const socket = io(url, { autoConnect: false });

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
