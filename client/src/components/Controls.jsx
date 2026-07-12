import { useState } from "react";
import {
  Mic, MicOff, Video, VideoOff, MonitorUp,
  MessageSquare, PhoneOff, Sparkles, Sun, Moon,
} from "lucide-react";

// Bottom toolbar: mute, camera, screen share, background, chat, theme, leave.
export default function Controls({
  onToggleAudio,
  onToggleVideo,
  onShareScreen,
  onToggleBackground,
  onToggleChat,
  onToggleTheme,
  onLeave,
  chatOpen,
  bgOpen,
  theme,
}) {
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  return (
    <footer className="controls">
      <button
        className={`ctrl ${audioOn ? "" : "off"}`}
        onClick={() => setAudioOn(onToggleAudio())}
        title={audioOn ? "Mute" : "Unmute"}
      >
        {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
        <span>{audioOn ? "Mute" : "Unmute"}</span>
      </button>

      <button
        className={`ctrl ${videoOn ? "" : "off"}`}
        onClick={() => setVideoOn(onToggleVideo())}
        title={videoOn ? "Stop video" : "Start video"}
      >
        {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
        <span>{videoOn ? "Stop" : "Start"}</span>
      </button>

      <button className="ctrl" onClick={onShareScreen} title="Share screen">
        <MonitorUp size={22} />
        <span>Share</span>
      </button>

      <button
        className={`ctrl ${bgOpen ? "active" : ""}`}
        onClick={onToggleBackground}
        title="Change background"
      >
        <Sparkles size={22} />
        <span>Effects</span>
      </button>

      <button
        className={`ctrl ${chatOpen ? "active" : ""}`}
        onClick={onToggleChat}
        title="Chat"
      >
        <MessageSquare size={22} />
        <span>Chat</span>
      </button>

      <button className="ctrl" onClick={onToggleTheme} title="Toggle theme">
        {theme === "dark" ? <Sun size={22} /> : <Moon size={22} />}
        <span>Theme</span>
      </button>

      <button className="ctrl leave" onClick={onLeave} title="Leave">
        <PhoneOff size={22} />
        <span>Leave</span>
      </button>
    </footer>
  );
}
