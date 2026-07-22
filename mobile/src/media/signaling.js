import { io } from 'socket.io-client';

/**
 * The signalling socket, speaking the exact protocol the web client speaks —
 * that is the whole point of using react-native-webrtc over an SFU SDK. No
 * server changes, and a phone and a laptop land in the same room.
 *
 * SIGNALING_URL must be reachable from the device, which is the one thing that
 * trips everyone up: `localhost` on a phone means the phone. For a dev server
 * on your machine use the LAN IP, or `adb reverse tcp:3001 tcp:3001`.
 */
export const SIGNALING_URL = 'https://meet.elloindia.in';

export const socket = io(SIGNALING_URL, {
  autoConnect: false,
  transports: ['websocket'], // RN has no XHR long-polling worth falling back to
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
  return socket;
}
