import VideoTile from "./VideoTile.jsx";

// Lays out all participant tiles in a responsive grid that adapts to count.
export default function VideoGrid({ localStream, localName, peers }) {
  const peerEntries = Object.entries(peers);
  const total = peerEntries.length + 1;

  return (
    <div className={`grid grid-${Math.min(total, 4)}`}>
      {/* Your own video is muted to avoid audio feedback. */}
      <VideoTile stream={localStream} name={localName} muted isLocal />

      {peerEntries.map(([id, peer]) => (
        <VideoTile key={id} stream={peer.stream} name={peer.name} />
      ))}
    </div>
  );
}
