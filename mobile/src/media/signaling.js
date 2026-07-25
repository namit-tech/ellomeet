import { io } from 'socket.io-client';

/**
 * The signalling socket, speaking the same protocol as the web client — same
 * server, same rooms, so a phone and a laptop land in the same meeting.
 *
 * The URL must be reachable FROM THE DEVICE, which is the thing that trips
 * everyone up: `localhost` on a phone means the phone, not your machine. In
 * debug builds we point at localhost anyway and rely on:
 *
 *     adb reverse tcp:3001 tcp:3001
 *
 * which forwards the device's localhost:3001 to the development machine. That
 * survives changing Wi-Fi networks, unlike hardcoding a LAN IP.
 */
export const SIGNALING_URL = 'https://meetapi.elloindia.in';

export const socket = io(SIGNALING_URL, {
  autoConnect: false,
  transports: ['websocket'], // RN has no XHR long-polling worth falling back to
});

// Ask the server for a fresh, unguessable room. The client never invents codes.
// Returns { tenant, code, roomId, hasPasscode }; join with `roomId`.
export async function createRoomCode({ tenant, passcode } = {}) {
  const res = await fetch(`${SIGNALING_URL}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenant, passcode }),
  });
  if (!res.ok) throw new Error(`mint failed: ${res.status}`);
  return res.json();
}

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
