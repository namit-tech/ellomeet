import {
  X, Mic, MicOff, Video, VideoOff, Hand, MonitorUp,
  Crown, UserX, Lock, Unlock, PhoneOff, Check,
} from "lucide-react";

/**
 * Participants — who's here, what state they're in, and (for the host) the
 * moderator controls: mute someone, remove them, lock the room, admit the
 * people knocking, or end the meeting for everyone.
 */
export default function Participants({
  participants,
  waiting,
  selfId,
  isHost,
  locked,
  host,
  onClose,
}) {
  return (
    <aside className="panel participants">
      <div className="panel-header">
        <span>Participants ({participants.length})</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close participants">
          <X size={18} />
        </button>
      </div>

      {/* Knock queue — host only; nobody else needs to see who's waiting. */}
      {isHost && waiting.length > 0 && (
        <div className="waiting-list">
          <p className="panel-note">Waiting to join</p>
          {waiting.map((w) => (
            <div key={w.id} className="waiting-row">
              <span className="pt-name">{w.name}</span>
              <div className="waiting-actions">
                <button className="btn small primary" onClick={() => host.admit(w.id)}>
                  <Check size={14} /> Admit
                </button>
                <button className="btn small ghost" onClick={() => host.deny(w.id)}>
                  Deny
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pt-list">
        {participants.map((p) => {
          const isSelf = p.id === selfId;
          return (
            <div key={p.id} className="pt-row">
              <div className="pt-avatar">{initials(p.name)}</div>

              <div className="pt-main">
                <span className="pt-name">
                  {p.name}
                  {isSelf && <span className="pt-tag">You</span>}
                  {p.isHost && (
                    <span className="pt-tag host">
                      <Crown size={11} /> Host
                    </span>
                  )}
                </span>
                <span className="pt-state">
                  {p.hand && <Hand size={13} className="on-hand" />}
                  {p.sharing && <MonitorUp size={13} className="on-share" />}
                  {p.audio ? <Mic size={13} /> : <MicOff size={13} className="off" />}
                  {p.video ? <Video size={13} /> : <VideoOff size={13} className="off" />}
                </span>
              </div>

              {isHost && !isSelf && (
                <div className="pt-actions">
                  <button
                    className="icon-btn"
                    title="Mute for everyone"
                    onClick={() => host.mute(p.id)}
                    disabled={!p.audio}
                  >
                    <MicOff size={16} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title={`Remove ${p.name}`}
                    onClick={() => host.remove(p.id)}
                  >
                    <UserX size={16} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isHost && (
        <div className="host-tools">
          <p className="panel-note">Host controls</p>

          <button className="btn small" onClick={() => host.setLocked(!locked)}>
            {locked ? <Unlock size={15} /> : <Lock size={15} />}
            {locked ? "Unlock meeting" : "Lock meeting"}
          </button>
          <p className="hint">
            {locked
              ? "New people must be admitted by you."
              : "Anyone with the link can walk straight in."}
          </p>

          <button className="btn small danger-btn" onClick={host.end}>
            <PhoneOff size={15} /> End for everyone
          </button>
        </div>
      )}
    </aside>
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
