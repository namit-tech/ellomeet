/**
 * In-room text chat. The server keeps the last 200 messages (see Room#addChat)
 * so someone joining late doesn't walk into an empty transcript.
 */
export function send({ socket, data, deps }) {
  const { registry, broadcast } = deps;

  const room = registry.get(socket.data.room);
  if (!room || !room.has(socket.id)) return;

  broadcast.chat(room, {
    id: socket.id,
    name: socket.data.name,
    text: data.text,
    ts: Date.now(),
  });
}
