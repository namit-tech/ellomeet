import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Link as LinkIcon, Check, Users } from "lucide-react";
import { useWebRTC } from "./hooks/useWebRTC.js";
import { useTheme } from "./hooks/useTheme.js";
import VideoGrid from "./components/VideoGrid.jsx";
import Controls from "./components/Controls.jsx";
import Chat from "./components/Chat.jsx";
import BackgroundPanel from "./components/BackgroundPanel.jsx";

export default function Room() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const name = useMemo(() => sessionStorage.getItem("meet:name") || "Guest", []);
  const { theme, toggleTheme } = useTheme();

  const {
    localStream,
    peers,
    messages,
    status,
    bgReady,
    toggleAudio,
    toggleVideo,
    shareScreen,
    setBackground,
    sendChat,
  } = useWebRTC({ roomId, name });

  const [chatOpen, setChatOpen] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);
  const [activeBg, setActiveBg] = useState("none");
  const [copied, setCopied] = useState(false);

  function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function chooseBackground(key, effect, image) {
    setActiveBg(key);
    setBackground(effect, image);
  }

  function leave() {
    navigate("/");
  }

  if (status === "full") {
    return (
      <div className="centered">
        <div className="landing-card">
          <h2>Room is full</h2>
          <p className="subtitle">This meeting already has 4 participants (mesh limit).</p>
          <button className="btn primary" onClick={leave}>Back home</button>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="centered">
        <div className="landing-card">
          <h2>Camera / mic blocked</h2>
          <p className="subtitle">
            Allow camera and microphone access, then reload. On non-localhost URLs
            you must use HTTPS.
          </p>
          <button className="btn primary" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  const peerCount = Object.keys(peers).length + 1;

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-info">
          <span className="room-badge"><Users size={15} /> {peerCount} / 4</span>
          <span className="room-code">Room <strong>{roomId}</strong></span>
        </div>
        <button className="btn small ghost" onClick={copyLink}>
          {copied ? <><Check size={16} /> Copied</> : <><LinkIcon size={16} /> Invite link</>}
        </button>
      </header>

      <div className="room-body">
        <VideoGrid localStream={localStream} localName={name} peers={peers} />
        {bgOpen && (
          <BackgroundPanel
            onSelect={chooseBackground}
            onClose={() => setBgOpen(false)}
            disabled={!bgReady}
            active={activeBg}
          />
        )}
        {chatOpen && (
          <Chat messages={messages} onSend={sendChat} onClose={() => setChatOpen(false)} />
        )}
      </div>

      <Controls
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onShareScreen={shareScreen}
        onToggleBackground={() => setBgOpen((v) => !v)}
        onToggleChat={() => setChatOpen((v) => !v)}
        onToggleTheme={toggleTheme}
        onLeave={leave}
        chatOpen={chatOpen}
        bgOpen={bgOpen}
        theme={theme}
      />
    </div>
  );
}
