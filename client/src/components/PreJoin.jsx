import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Video, VideoOff, Camera, Volume2 } from "lucide-react";
import { listDevices, canChooseSpeaker, loadDevicePrefs, saveDevicePrefs } from "../model/devices.js";

/**
 * PreJoin — the "green room". You see yourself, pick your camera/mic/speaker
 * and decide whether to walk in muted, all BEFORE anyone else can see or hear
 * you. This preview stream is stopped on join; the call then re-acquires the
 * devices you picked.
 */
export default function PreJoin({ roomId, name, onChangeName, onJoin }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const prefs = loadDevicePrefs();
  const [devices, setDevices] = useState({ cameras: [], mics: [], speakers: [] });
  const [videoDeviceId, setVideoDeviceId] = useState(prefs.videoDeviceId || "");
  const [audioDeviceId, setAudioDeviceId] = useState(prefs.audioDeviceId || "");
  const [speakerId, setSpeakerId] = useState(prefs.speakerId || "");
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [error, setError] = useState(null);

  // (Re)open the preview whenever the chosen camera or mic changes.
  useEffect(() => {
    let cancelled = false;

    async function open() {
      streamRef.current?.getTracks().forEach((t) => t.stop());

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        stream.getAudioTracks().forEach((t) => (t.enabled = audioOn));
        stream.getVideoTracks().forEach((t) => (t.enabled = videoOn));
        if (videoRef.current) videoRef.current.srcObject = stream;
        setError(null);

        // Labels are only readable once permission has been granted.
        setDevices(await listDevices());
      } catch (err) {
        console.error("preview getUserMedia failed:", err);
        if (!cancelled) setError(err.name === "NotAllowedError" ? "blocked" : "missing");
      }
    }

    open();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoDeviceId, audioDeviceId]);

  // Stop the preview when we leave this screen for good.
  useEffect(
    () => () => streamRef.current?.getTracks().forEach((t) => t.stop()),
    []
  );

  function toggleAudio() {
    const next = !audioOn;
    setAudioOn(next);
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }

  function toggleVideo() {
    const next = !videoOn;
    setVideoOn(next);
    streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
  }

  function join() {
    saveDevicePrefs({ videoDeviceId, audioDeviceId, speakerId });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    onJoin({ audio: audioOn, video: videoOn, videoDeviceId, audioDeviceId, speakerId });
  }

  return (
    <div className="prejoin">
      <div className="prejoin-preview">
        <video ref={videoRef} autoPlay playsInline muted className="mirrored" />

        {!videoOn && !error && (
          <div className="prejoin-off">
            <VideoOff size={30} />
            <span>Camera is off</span>
          </div>
        )}

        {error && (
          <div className="prejoin-off">
            <VideoOff size={30} />
            <span>
              {error === "blocked"
                ? "Camera and mic are blocked. Allow them in your browser, then reload."
                : "No camera or microphone found."}
            </span>
          </div>
        )}

        <div className="prejoin-toggles">
          <button
            className={`round ${audioOn ? "" : "off"}`}
            onClick={toggleAudio}
            title={audioOn ? "Mute" : "Unmute"}
          >
            {audioOn ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            className={`round ${videoOn ? "" : "off"}`}
            onClick={toggleVideo}
            title={videoOn ? "Turn camera off" : "Turn camera on"}
          >
            {videoOn ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        </div>
      </div>

      <div className="prejoin-side">
        <h2>Ready to join?</h2>
        <p className="subtitle">
          Room <strong>{roomId}</strong>
        </p>

        <label>
          Your name
          <input
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="Your name"
            maxLength={30}
          />
        </label>

        <label>
          <span className="lbl"><Camera size={14} /> Camera</span>
          <select value={videoDeviceId} onChange={(e) => setVideoDeviceId(e.target.value)}>
            <option value="">Default camera</option>
            {devices.cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="lbl"><Mic size={14} /> Microphone</span>
          <select value={audioDeviceId} onChange={(e) => setAudioDeviceId(e.target.value)}>
            <option value="">Default microphone</option>
            {devices.mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>

        {canChooseSpeaker && devices.speakers.length > 0 && (
          <label>
            <span className="lbl"><Volume2 size={14} /> Speaker</span>
            <select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)}>
              <option value="">Default speaker</option>
              {devices.speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
        )}

        <button className="btn primary" onClick={join} disabled={error === "blocked"}>
          Join now
        </button>
      </div>
    </div>
  );
}
