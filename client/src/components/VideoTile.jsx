import { useEffect, useRef } from "react";
import { MicOff, Hand, MonitorUp, Crown, Pin, PinOff, SignalLow, SignalMedium } from "lucide-react";

/**
 * VideoTile — one participant.
 *
 * Everything the tile shows besides the pixels (muted, hand up, presenting,
 * host) comes from the server roster rather than being guessed at from the
 * media stream. That's what makes someone else's mute state visible at all.
 */
export default function VideoTile({
  stream,
  participant,
  muted = false,
  isLocal = false,
  isSelfShare = false,
  speaking = false,
  quality,
  pinned = false,
  onTogglePin,
  speakerId,
}) {
  const videoRef = useRef(null);

  const name = participant?.name || "Guest";
  const micOff = participant ? !participant.audio : false;
  const camOff = participant ? !participant.video : false;
  const sharing = participant?.sharing;
  const isHost = participant?.isHost;

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  // Route audio to the chosen output device (Chromium only).
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !speakerId || typeof el.setSinkId !== "function") return;
    el.setSinkId(speakerId).catch((err) => console.warn("setSinkId failed:", err));
  }, [speakerId]);

  // Never mirror a screen share — the text would come out backwards.
  const mirrored = isLocal && !isSelfShare;
  // While presenting, the video IS the screen, so the camera-off avatar is wrong.
  const showPlaceholder = !stream || (camOff && !sharing);

  return (
    <div className={`tile ${speaking ? "speaking" : ""} ${pinned ? "pinned" : ""}`}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={mirrored ? "mirrored" : ""}
      />

      {showPlaceholder && (
        <div className="tile-placeholder">
          <div className="tile-avatar">{initials(name)}</div>
        </div>
      )}

      {participant?.hand && (
        <div className="tile-hand" title={`${name} raised their hand`}>
          <Hand size={16} />
        </div>
      )}

      <div className="tile-top">
        {sharing && (
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

      {onTogglePin && (
        <button
          className="tile-pin"
          onClick={onTogglePin}
          title={pinned ? "Unpin" : "Pin to the big tile"}
        >
          {pinned ? <PinOff size={15} /> : <Pin size={15} />}
        </button>
      )}

      <div className="tile-name">
        {micOff && <MicOff size={13} className="tile-mic-off" />}
        {isHost && <Crown size={12} className="tile-crown" />}
        <span className="tile-label">{name}</span>
        {isLocal && <span className="tile-you">You</span>}
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
