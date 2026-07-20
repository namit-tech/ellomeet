import VideoTile from "./VideoTile.jsx";

/**
 * VideoGrid — even grid by default; spotlight (one big tile + a filmstrip) when
 * someone is pinned or presenting.
 *
 * A live screen share auto-spotlights the presenter, because a shared screen in
 * a quarter-size tile is unreadable. An explicit pin always wins over that.
 */
export default function VideoGrid({
  participants,
  peers,
  localStream,
  selfId,
  speaking,
  quality,
  pinnedId,
  onTogglePin,
  speakerId,
  sharing,
}) {
  const presenter = participants.find((p) => p.sharing);
  const focusId = pinnedId || presenter?.id || null;
  const focus = focusId ? participants.find((p) => p.id === focusId) : null;

  const streamFor = (p) => (p.id === selfId ? localStream : peers[p.id]?.stream || null);

  const tileFor = (p) => (
    <VideoTile
      key={p.id}
      participant={p}
      stream={streamFor(p)}
      muted={p.id === selfId} // never play your own audio back at you
      isLocal={p.id === selfId}
      isSelfShare={p.id === selfId && sharing}
      speaking={!!speaking[p.id]}
      quality={p.id === selfId ? undefined : quality[p.id]}
      pinned={p.id === focusId}
      onTogglePin={() => onTogglePin(p.id === pinnedId ? null : p.id)}
      speakerId={speakerId}
    />
  );

  if (focus) {
    const others = participants.filter((p) => p.id !== focus.id);
    return (
      <div className="stage spotlight">
        <div className="stage-main">{tileFor(focus)}</div>
        {others.length > 0 && <div className="filmstrip">{others.map(tileFor)}</div>}
      </div>
    );
  }

  return (
    <div className={`stage grid grid-${Math.min(participants.length, 4)}`}>
      {participants.map(tileFor)}
    </div>
  );
}
