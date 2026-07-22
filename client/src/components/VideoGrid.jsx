import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import VideoTile from "./VideoTile.jsx";
import { GRID_PAGE_SIZE, STRIP_PAGE_SIZE } from "../model/livekitRoom.js";

/**
 * VideoGrid — even grid by default; spotlight (one big tile + a filmstrip) when
 * something is pinned, selected, or being presented.
 *
 * Any number of people can present at once. Each presenter contributes TWO
 * tiles — their camera and their screen — because the two arrive on separate
 * m-lines (see useWebRTC), so you can keep watching a face while reading
 * someone else's slides.
 *
 * Which tile fills the stage is decided in this order:
 *
 *   1. pinned    an explicit, sticky choice. Survives new presentations
 *                starting and other people being clicked. Nothing overrides it.
 *   2. selected  the tile the viewer last clicked. Transient — a pin replaces
 *                it, and it is dropped if that tile goes away.
 *   3. the first live presentation, because an unread screen in a
 *      quarter-size tile is the one thing nobody can work with.
 *
 * Tiles are keyed by `id` for a camera and `id:screen` for a screen, and those
 * keys are what pinning and selection address — so a screen can be pinned
 * independently of the person presenting it.
 */
export default function VideoGrid({
  participants,
  peers,
  localCamera,
  localScreen,
  selfId,
  speaking,
  quality,
  pinnedId,
  onTogglePin,
  selectedId,
  onSelect,
  speakerId,
}) {
  const cameraFor = (p) => (p.id === selfId ? localCamera : peers[p.id]?.camera || null);
  const micFor = (p) => (p.id === selfId ? null : peers[p.id]?.mic || null);
  const screenFor = (p) => (p.id === selfId ? localScreen : peers[p.id]?.screen || null);
  const screenAudioFor = (p) => (p.id === selfId ? null : peers[p.id]?.screenAudio || null);

  const tiles = [];
  for (const p of participants) {
    tiles.push({
      key: p.id,
      participant: p,
      track: cameraFor(p),
      audioTrack: micFor(p),
      isScreen: false,
    });
  }
  for (const p of participants) {
    if (!p.sharing) continue;
    const screen = screenFor(p);
    // A roster that says "presenting" before the track has arrived would
    // otherwise render a permanently black tile.
    if (screen) {
      tiles.push({
        key: `${p.id}:screen`,
        participant: p,
        track: screen,
        audioTrack: screenAudioFor(p),
        isScreen: true,
      });
    }
  }

  const has = (key) => key && tiles.some((t) => t.key === key);
  const firstScreen = tiles.find((t) => t.isScreen);

  const focusKey =
    (has(pinnedId) && pinnedId) || (has(selectedId) && selectedId) || firstScreen?.key || null;
  const focus = focusKey ? tiles.find((t) => t.key === focusKey) : null;

  const others = focus ? tiles.filter((t) => t.key !== focus.key) : tiles;
  const pageSize = focus ? STRIP_PAGE_SIZE : GRID_PAGE_SIZE;

  // Whoever is talking is promoted onto the visible page, so the person you
  // want to see is never stranded three pages away. Everything else keeps its
  // roster order — churning the layout on every syllable is worse than the
  // problem it solves.
  const ordered = [...others].sort((a, b) => {
    const sa = !a.isScreen && speaking[a.participant.id] ? 1 : 0;
    const sb = !b.isScreen && speaking[b.participant.id] ? 1 : 0;
    return sb - sa;
  });

  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize));
  const [page, setPage] = useState(0);
  const safePage = Math.min(page, pageCount - 1);

  // People leaving can shrink the deck out from under the current page.
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  // THIS is the bandwidth saving: a tile that is not rendered is never
  // attached, so adaptiveStream pauses the track at the server and it costs
  // nothing. Slicing the list is not a cosmetic decision.
  const visible = ordered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const render = (t) => (
    <VideoTile
      key={t.key}
      participant={t.participant}
      track={t.track}
      audioTrack={t.audioTrack}
      isScreen={t.isScreen}
      // Never play your own audio back at you — including your own system audio.
      muted={t.participant.id === selfId}
      isLocal={t.participant.id === selfId}
      speaking={!t.isScreen && !!speaking[t.participant.id]}
      quality={t.participant.id === selfId ? undefined : quality[t.participant.id]}
      pinned={t.key === pinnedId}
      selected={t.key === focusKey}
      onSelect={() => onSelect(t.key)}
      onTogglePin={() => onTogglePin(t.key === pinnedId ? null : t.key)}
      speakerId={speakerId}
    />
  );

  const pager =
    pageCount > 1 ? (
      <div className="pager">
        <button
          className="pager-btn"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={safePage === 0}
          title="Previous"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="pager-label">
          {safePage + 1} / {pageCount}
        </span>
        <button
          className="pager-btn"
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          disabled={safePage === pageCount - 1}
          title="Next"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    ) : null;

  if (focus) {
    return (
      <div className="stage spotlight">
        <div className="stage-main">{render(focus)}</div>
        {visible.length > 0 && (
          <div className="filmstrip-wrap">
            <div className="filmstrip">{visible.map(render)}</div>
            {pager}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="stage">
      <div className={`grid grid-${Math.min(visible.length, GRID_PAGE_SIZE)}`}>
        {visible.map(render)}
      </div>
      {pager}
    </div>
  );
}
