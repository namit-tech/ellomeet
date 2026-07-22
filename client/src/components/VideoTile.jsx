import { useEffect, useRef } from "react";
import {
  MicOff, Hand, MonitorUp, Crown, Pin, PinOff,
  SignalLow, SignalMedium, Maximize2,
} from "lucide-react";
import { requestFullscreen } from "../model/capabilities.js";

/**
 * VideoTile — one participant's camera, or one participant's screen.
 *
 * Everything the tile shows besides the pixels (muted, hand up, presenting,
 * host) comes from the server roster rather than being guessed at from the
 * media stream. That's what makes someone else's mute state visible at all.
 *
 * Three ways to enlarge a tile, deliberately distinct:
 *   - click        select it into the spotlight (and, for a screen, go
 *                  fullscreen — picking a screen means you want to read it)
 *   - pin          keep it in the spotlight even as others start presenting
 *   - fullscreen   hand it to the OS, filling the display
 */
export default function VideoTile({
  track,
  audioTrack,
  participant,
  muted = false,
  isLocal = false,
  isScreen = false,
  speaking = false,
  quality,
  pinned = false,
  selected = false,
  onSelect,
  onTogglePin,
  speakerId,
}) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const tileRef = useRef(null);

  const goFullscreen = () => requestFullscreen(tileRef.current, videoRef.current);

  const name = participant?.name || "Guest";
  const micOff = participant ? !participant.audio : false;
  const camOff = participant ? !participant.video : false;
  const sharing = participant?.sharing;
  const isHost = participant?.isHost;

  // attach(), NOT srcObject.
  //
  // LiveKit's adaptive stream watches the element a track is attached to — its
  // rendered size decides which simulcast layer to pull, and its visibility
  // decides whether the track is forwarded at all. Assigning srcObject by hand
  // bypasses that observer entirely: the tile would quietly pull full
  // resolution for a thumbnail, and with adaptiveStream on it may never start
  // playing at all.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return undefined;
    track.attach(el);
    return () => track.detach(el);
  }, [track]);

  // Remote audio needs its own element: attaching two tracks to one <video>
  // isn't a thing, and the tile's video element is muted for local tiles.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audioTrack) return undefined;
    audioTrack.attach(el);
    return () => audioTrack.detach(el);
  }, [audioTrack]);

  // Route audio to the chosen output device (Chromium only).
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !speakerId || typeof el.setSinkId !== "function") return;
    el.setSinkId(speakerId).catch((err) => console.warn("setSinkId failed:", err));
  }, [speakerId]);

  // Never mirror a screen share — the text would come out backwards.
  const mirrored = isLocal && !isScreen;
  // A screen tile always has pixels; only a camera tile falls back to an avatar.
  const showPlaceholder = !isScreen && (!track || camOff);

  return (
    <div
      ref={tileRef}
      className={[
        "tile",
        speaking && "speaking",
        pinned && "pinned",
        selected && "selected",
        isScreen && "screen",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        onSelect?.();
        // Choosing someone's screen is a request to read it, so go all the way.
        // This runs inside the click, which is the user gesture the Fullscreen
        // API requires — deferring it would get the request rejected.
        if (isScreen) goFullscreen();
      }}
      onDoubleClick={goFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={mirrored ? "mirrored" : ""}
      />
      {/* Never play your own audio back at you. */}
      {!muted && <audio ref={audioRef} autoPlay />}

      {showPlaceholder && (
        <div className="tile-placeholder">
          <div className="tile-avatar">{initials(name)}</div>
        </div>
      )}

      {participant?.hand && !isScreen && (
        <div className="tile-hand" title={`${name} raised their hand`}>
          <Hand size={16} />
        </div>
      )}

      <div className="tile-top">
        {sharing && isScreen && (
          <span className="tile-chip share">
            <MonitorUp size={12} /> Presenting
          </span>
        )}
        {quality === "poor" && (
          <span className="tile-chip warn" title="Unstable connection">
            <SignalLow size={12} /> Weak
          </span>
        )}
        {quality === "ok" && (
          <span className="tile-chip" title="Connection is a little unstable">
            <SignalMedium size={12} />
          </span>
        )}
      </div>

      {/* Both actions stop propagation: the tile's own click selects it, and a
          button press must not be mistaken for that. */}
      <div className="tile-actions">
        {onTogglePin && (
          <button
            className={`tile-action ${pinned ? "on" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            title={pinned ? "Unpin" : "Pin — keep this in the spotlight"}
          >
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
        )}
        <button
          className="tile-action"
          onClick={(e) => {
            e.stopPropagation();
            goFullscreen();
          }}
          title="Fullscreen"
        >
          <Maximize2 size={15} />
        </button>
      </div>

      <div className="tile-name">
        {micOff && !isScreen && <MicOff size={13} className="tile-mic-off" />}
        {isHost && !isScreen && <Crown size={12} className="tile-crown" />}
        <span className="tile-label">{isScreen ? `${name}'s screen` : name}</span>
        {isLocal && !isScreen && <span className="tile-you">You</span>}
      </div>
    </div>
  );
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
