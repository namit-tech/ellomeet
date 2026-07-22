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
export const SIGNALING_URL = __DEV__
  ? 'http://localhost:3001'
  : 'https://meet.elloindia.in';

export const socket = io(SIGNALING_URL, {
  autoConnect: false,
  transports: ['websocket'], // RN has no XHR long-polling worth falling back to
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
