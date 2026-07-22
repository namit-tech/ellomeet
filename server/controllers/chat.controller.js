/**
 * In-room text chat. The server keeps the last 200 messages (see Room#addChat)
 * so someone joining late doesn't walk into an empty transcript.
 */
export async function send({ socket, data, deps }) {
  const { registry, broadcast } = deps;
  const roomId = socket.data.room;
  if (!roomId) return;

  const room = await registry.get(roomId);
  if (!room?.has(socket.id)) return;

  await broadcast.chat(registry, roomId, {
    id: socket.id,
    name: socket.data.name,
    text: data.text,
    ts: Date.now(),
  });
}
