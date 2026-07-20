import { useEffect, useState } from "react";
import { X, Camera, Mic, Volume2 } from "lucide-react";
import { listDevices, canChooseSpeaker, loadDevicePrefs, saveDevicePrefs } from "../lib/devices.js";

/**
 * Settings — switch camera, microphone or speaker mid-call.
 *
 * Camera and mic changes are applied through the WebRTC hook (which swaps the
 * outgoing track without renegotiating). Speaker choice is applied by the tiles
 * themselves via setSinkId, so it's just lifted up as state.
 */
export default function Settings({ onClose, onSwitchCamera, onSwitchMic, speakerId, onSpeaker }) {
  const [devices, setDevices] = useState({ cameras: [], mics: [], speakers: [] });
  const [camera, setCamera] = useState(loadDevicePrefs().videoDeviceId || "");
  const [mic, setMic] = useState(loadDevicePrefs().audioDeviceId || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listDevices().then(setDevices);

    // Devices come and go (headset plugged in, webcam unplugged).
    const refresh = () => listDevices().then(setDevices);
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  }, []);

  function persist(patch) {
    saveDevicePrefs({ ...loadDevicePrefs(), ...patch });
  }

  async function changeCamera(deviceId) {
    setCamera(deviceId);
    persist({ videoDeviceId: deviceId });
    if (!deviceId) return;
    setBusy(true);
    try {
      await onSwitchCamera(deviceId);
    } catch (err) {
      console.warn("camera switch failed:", err);
    } finally {
      setBusy(false);
    }
  }

  async function changeMic(deviceId) {
    setMic(deviceId);
    persist({ audioDeviceId: deviceId });
    if (!deviceId) return;
    setBusy(true);
    try {
      await onSwitchMic(deviceId);
    } catch (err) {
      console.warn("mic switch failed:", err);
    } finally {
      setBusy(false);
    }
  }

  function changeSpeaker(deviceId) {
    persist({ speakerId: deviceId });
    onSpeaker(deviceId);
  }

  return (
    <aside className="panel settings">
      <div className="panel-header">
        <span>Settings</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close settings">
          <X size={18} />
        </button>
      </div>

      <div className="settings-body">
        <label>
          <span className="lbl"><Camera size={14} /> Camera</span>
          <select value={camera} onChange={(e) => changeCamera(e.target.value)} disabled={busy}>
            <option value="">Default camera</option>
            {devices.cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>

        <label>
          <span className="lbl"><Mic size={14} /> Microphone</span>
          <select value={mic} onChange={(e) => changeMic(e.target.value)} disabled={busy}>
            <option value="">Default microphone</option>
            {devices.mics.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
            ))}
          </select>
        </label>

        {canChooseSpeaker ? (
          <label>
            <span className="lbl"><Volume2 size={14} /> Speaker</span>
            <select value={speakerId} onChange={(e) => changeSpeaker(e.target.value)}>
              <option value="">Default speaker</option>
              {devices.speakers.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="hint">
            Your browser doesn't allow choosing an output device — use your system
            sound settings instead.
          </p>
        )}

        <div className="shortcuts">
          <p className="panel-note">Shortcuts</p>
          <div><kbd>Ctrl</kbd> + <kbd>D</kbd> <span>Mute / unmute</span></div>
          <div><kbd>Ctrl</kbd> + <kbd>E</kbd> <span>Camera on / off</span></div>
          <div><kbd>Ctrl</kbd> + <kbd>H</kbd> <span>Raise / lower hand</span></div>
        </div>
      </div>
    </aside>
  );
}
