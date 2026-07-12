import { useEffect, useRef } from "react";

// Renders a single participant's video stream into a <video> element.
export default function VideoTile({ stream, name, muted = false, isLocal = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const initials = (name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="tile">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        // Mirror only your own camera, the way Meet/Zoom do.
        className={isLocal ? "mirrored" : ""}
      />
      {!stream && (
        <div className="tile-placeholder">
          <div className="tile-avatar">{initials}</div>
        </div>
      )}
      <div className="tile-name">
        {name}
        {isLocal && <span className="tile-you">You</span>}
      </div>
    </div>
  );
}
