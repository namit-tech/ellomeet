/**
 * WebRTC signaling: SDP offers/answers and ICE candidates, relayed verbatim to
 * one named peer. The server never inspects or stores media — this is a
 * postbox, and it exists only because two browsers can't find each other
 * without one.
 *
 * Peers are only allowed to signal people in the same room as them; otherwise
 * any connected socket could push SDP at any other socket on the server.
 */
function sameRoom({ socket, registry, to }) {
  const room = registry.get(socket.data.room);
  return !!room && room.has(socket.id) && room.has(to);
}

export function offer({ socket, data, deps }) {
  if (!sameRoom({ socket, registry: deps.registry, to: data.to })) return;
  deps.broadcast.toPeer(data.to, "offer", {
    from: socket.id,
    sdp: data.sdp,
    name: socket.data.name,
  });
}

export function answer({ socket, data, deps }) {
  if (!sameRoom({ socket, registry: deps.registry, to: data.to })) return;
  deps.broadcast.toPeer(data.to, "answer", { from: socket.id, sdp: data.sdp });
}

export function iceCandidate({ socket, data, deps }) {
  if (!sameRoom({ socket, registry: deps.registry, to: data.to })) return;
  deps.broadcast.toPeer(data.to, "ice-candidate", {
    from: socket.id,
    candidate: data.candidate,
  });
}
