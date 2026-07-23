import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Link as LinkIcon, Check, Users, Lock, Loader2 } from "lucide-react";
import { useLiveKit } from "./hooks/useLiveKit.js";
import { useTheme } from "./hooks/useTheme.js";
import { loadDevicePrefs } from "./model/devices.js";
import PreJoin from "./components/PreJoin.jsx";
import VideoGrid from "./components/VideoGrid.jsx";
import Controls from "./components/Controls.jsx";
import Chat from "./components/Chat.jsx";
import Participants from "./components/Participants.jsx";
import Settings from "./components/Settings.jsx";
import BackgroundPanel from "./components/BackgroundPanel.jsx";
import { ReactionOverlay } from "./components/Reactions.jsx";

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [name, setName] = useState(() => sessionStorage.getItem("meet:name") || "Guest");
  const [config, setConfig] = useState(null); // set by PreJoin; null = not joined yet

  // Nothing connects — no socket, no peer connections — until the pre-join
  // screen hands us a config. You are never live before you press Join.
  if (!config) {
    return (
      <PreJoin
        roomId={roomId}
        name={name}
        onChangeName={(n) => {
          setName(n);
          sessionStorage.setItem("meet:name", n);
        }}
        onJoin={setConfig}
      />
    );
  }

  return (
    <Call
      roomId={roomId}
      name={name}
      config={config}
      theme={theme}
      toggleTheme={toggleTheme}
      onExit={() => navigate("/")}
    />
  );
}

function Call({ roomId, name, config, theme, toggleTheme, onExit }) {
  const {
    selfId,
    localCamera,
    localScreen,
    peers,
    speaking,
    room,
    isHost,
    isModerator,
    messages,
    reactions,
    quality,
    maxPeers,
    status,
    notice,
    bgReady,
    audioOn,
    videoOn,
    handRaised,
    sharing,
    toggleAudio,
    toggleVideo,
    toggleHand,
    toggleShare,
    sendReaction,
    switchCamera,
    switchMic,
    setBackground,
    sendChat,
    host,
  } = useLiveKit({ roomId, name, initial: config });

  const [panel, setPanel] = useState(null); // null | chat | people | bg | settings
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [activeBg, setActiveBg] = useState("none");
  const [pinnedId, setPinnedId] = useState(null); // sticky choice
  const [selectedId, setSelectedId] = useState(null); // last clicked tile
  const [speakerId, setSpeakerId] = useState(config.speakerId || loadDevicePrefs().speakerId || "");
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Unread chat badge: count what arrived while the chat panel was closed.
  const [unread, setUnread] = useState(0);
  const seenRef = useRef(0);

  useEffect(() => {
    if (panel === "chat") {
      seenRef.current = messages.length;
      setUnread(0);
    } else {
      const missed = messages
        .slice(seenRef.current)
        .filter((m) => !m.system && m.id !== selfId).length;
      setUnread(missed);
    }
  }, [messages, panel, selfId]);

  // Meeting duration.
  useEffect(() => {
    if (status !== "connected") return undefined;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  // Keyboard shortcuts, the way every other call app does them.
  useEffect(() => {
    function onKey(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        toggleAudio();
      } else if (key === "e") {
        e.preventDefault();
        toggleVideo();
      } else if (key === "h") {
        e.preventDefault();
        toggleHand();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAudio, toggleVideo, toggleHand]);

  // Someone who left shouldn't strand the spotlight. Pins and selections are
  // tile keys, and a presenter's screen tile is keyed "<id>:screen", so compare
  // on the participant half.
  useEffect(() => {
    const gone = (key) => key && !room.participants.some((p) => p.id === key.split(":")[0]);
    if (gone(pinnedId)) setPinnedId(null);
    if (gone(selectedId)) setSelectedId(null);
  }, [room.participants, pinnedId, selectedId]);

  // A selected screen that stopped being shared should release the stage rather
  // than hold it on a tile that no longer exists.
  useEffect(() => {
    if (!selectedId?.endsWith(":screen")) return;
    const owner = room.participants.find((p) => p.id === selectedId.split(":")[0]);
    if (!owner?.sharing) setSelectedId(null);
  }, [room.participants, selectedId]);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function chooseBackground(key, effect, image) {
    setActiveBg(key);
    setBackground(effect, image);
  }

  function togglePanel(next) {
    setPanel((cur) => (cur === next ? null : next));
    setReactionsOpen(false);
  }

  // --- terminal states ------------------------------------------------------

  if (status === "waiting") {
    return (
      <Message
        icon={<Loader2 size={28} className="spin" />}
        title="Waiting to be let in"
        body="This meeting is locked. The host has been asked to admit you."
        action={{ label: "Cancel", onClick: onExit }}
      />
    );
  }

  if (status === "full") {
    return (
      <Message
        title="Room is full"
        body={`This meeting is at its limit of ${maxPeers || ""} participants.`.replace("  ", " ")}
        action={{ label: "Back home", onClick: onExit }}
      />
    );
  }

  if (status === "denied") {
    return (
      <Message
        title="Not admitted"
        body="The host didn't let you into this meeting."
        action={{ label: "Back home", onClick: onExit }}
      />
    );
  }

  if (status === "removed") {
    return (
      <Message
        title="You were removed"
        body="The host removed you from this meeting."
        action={{ label: "Back home", onClick: onExit }}
      />
    );
  }

  if (status === "ended") {
    return (
      <Message
        title="Meeting ended"
        body="The host ended this meeting for everyone."
        action={{ label: "Back home", onClick: onExit }}
      />
    );
  }

  if (status === "no-media-server") {
    return (
      <Message
        title="Media server not configured"
        body="The signalling server is up, but it has no LiveKit credentials, so no audio or video can flow. Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in server/.env and restart it."
        action={{ label: "Retry", onClick: () => window.location.reload() }}
      />
    );
  }

  if (status === "error") {
    return (
      <Message
        title="Camera / mic blocked"
        body="Allow camera and microphone access, then reload. On non-localhost URLs you must use HTTPS."
        action={{ label: "Retry", onClick: () => window.location.reload() }}
      />
    );
  }

  const participants = room.participants;

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-info">
          <img src="/logo.png" alt="Ello Meet" className="room-logo" />
          <span className="room-badge">
            <Users size={15} /> {participants.length}{maxPeers ? ` / ${maxPeers}` : ""}
          </span>
          <span className="room-code">
            Room <strong>{roomId}</strong>
          </span>
          {room.locked && (
            <span className="room-locked" title="Locked — new people must be admitted">
              <Lock size={13} /> Locked
            </span>
          )}
          <span className="room-timer">{formatDuration(elapsed)}</span>
        </div>

        <button className="btn small ghost" onClick={copyLink}>
          {copied ? (
            <>
              <Check size={16} /> Copied
            </>
          ) : (
            <>
              <LinkIcon size={16} /> Invite link
            </>
          )}
        </button>
      </header>

      <div className="room-body">
        <div className="stage-wrap">
          <VideoGrid
            participants={participants}
            peers={peers}
            localCamera={localCamera}
            localScreen={localScreen}
            selfId={selfId}
            speaking={speaking}
            quality={quality}
            pinnedId={pinnedId}
            onTogglePin={setPinnedId}
            selectedId={selectedId}
            onSelect={setSelectedId}
            speakerId={speakerId}
          />
          <ReactionOverlay reactions={reactions} />
        </div>

        {panel === "bg" && (
          <BackgroundPanel
            onSelect={chooseBackground}
            onClose={() => setPanel(null)}
            disabled={!bgReady}
            active={activeBg}
          />
        )}

        {panel === "people" && (
          <Participants
            participants={participants}
            waiting={room.waiting}
            selfId={selfId}
            isHost={isHost}
            isModerator={isModerator}
            locked={room.locked}
            host={host}
            onClose={() => setPanel(null)}
          />
        )}

        {panel === "settings" && (
          <Settings
            onClose={() => setPanel(null)}
            onSwitchCamera={switchCamera}
            onSwitchMic={switchMic}
            speakerId={speakerId}
            onSpeaker={setSpeakerId}
          />
        )}

        {panel === "chat" && (
          <Chat
            messages={messages}
            selfId={selfId}
            onSend={sendChat}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      {notice && <div className="toast">{notice}</div>}

      {isHost && room.waiting.length > 0 && panel !== "people" && (
        <button className="knock-toast" onClick={() => setPanel("people")}>
          {room.waiting.length === 1
            ? `${room.waiting[0].name} wants to join`
            : `${room.waiting.length} people want to join`}
          <span className="knock-cta">Review</span>
        </button>
      )}

      <Controls
        audioOn={audioOn}
        videoOn={videoOn}
        sharing={sharing}
        handRaised={handRaised}
        chatOpen={panel === "chat"}
        bgOpen={panel === "bg"}
        participantsOpen={panel === "people"}
        settingsOpen={panel === "settings"}
        reactionsOpen={reactionsOpen}
        unreadCount={unread}
        participantCount={participants.length}
        theme={theme}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleShare={toggleShare}
        onToggleHand={toggleHand}
        onToggleBackground={() => togglePanel("bg")}
        onToggleChat={() => togglePanel("chat")}
        onToggleParticipants={() => togglePanel("people")}
        onToggleSettings={() => togglePanel("settings")}
        onToggleReactions={() => setReactionsOpen((v) => !v)}
        onReact={sendReaction}
        onToggleTheme={toggleTheme}
        onLeave={onExit}
      />
    </div>
  );
}

function Message({ icon, title, body, action }) {
  return (
    <div className="centered">
      <div className="landing-card">
        {icon}
        <h2>{title}</h2>
        <p className="subtitle">{body}</p>
        <button className="btn primary" onClick={action.onClick}>
          {action.label}
        </button>
      </div>
    </div>
  );
}

function formatDuration(total) {
  const m = String(Math.floor(total / 60)).padStart(2, "0");
  const s = String(total % 60).padStart(2, "0");
  return `${m}:${s}`;
}
