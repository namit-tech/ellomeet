import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MonitorX,
  MessageSquare, PhoneOff, Sparkles, Sun, Moon,
  Hand, Smile, Users, Settings as SettingsIcon,
} from "lucide-react";
import { ReactionPicker } from "./Reactions.jsx";
import { canShareScreen, screenShareUnavailableReason } from "../model/capabilities.js";

/**
 * Controls — the bottom toolbar.
 *
 * Mute/camera state is owned by the WebRTC hook, not by this component: the
 * host can mute you remotely, so the toolbar has to reflect state it didn't set.
 */
export default function Controls({
  audioOn,
  videoOn,
  sharing,
  handRaised,
  chatOpen,
  bgOpen,
  participantsOpen,
  settingsOpen,
  reactionsOpen,
  unreadCount,
  participantCount,
  theme,
  onToggleAudio,
  onToggleVideo,
  onToggleShare,
  onToggleHand,
  onToggleBackground,
  onToggleChat,
  onToggleParticipants,
  onToggleSettings,
  onToggleReactions,
  onReact,
  onToggleTheme,
  onLeave,
}) {
  return (
    <footer className="controls">
      {reactionsOpen && <ReactionPicker onPick={onReact} onClose={onToggleReactions} />}

      <button
        className={`ctrl ${audioOn ? "" : "off"}`}
        onClick={onToggleAudio}
        title={audioOn ? "Mute (Ctrl+D)" : "Unmute (Ctrl+D)"}
      >
        {audioOn ? <Mic size={22} /> : <MicOff size={22} />}
        <span>{audioOn ? "Mute" : "Unmute"}</span>
      </button>

      <button
        className={`ctrl ${videoOn ? "" : "off"}`}
        onClick={onToggleVideo}
        title={videoOn ? "Stop video (Ctrl+E)" : "Start video (Ctrl+E)"}
      >
        {videoOn ? <Video size={22} /> : <VideoOff size={22} />}
        <span>{videoOn ? "Stop" : "Start"}</span>
      </button>

      {/* Disabled rather than hidden: a missing button reads as a bug, while a
          disabled one with a reason explains that no mobile browser implements
          getDisplayMedia. See model/capabilities.js. */}
      <button
        className={`ctrl ${sharing ? "active" : ""}`}
        onClick={onToggleShare}
        disabled={!canShareScreen}
        title={
          screenShareUnavailableReason() ||
          (sharing ? "Stop presenting" : "Present your screen")
        }
      >
        {sharing ? <MonitorX size={22} /> : <MonitorUp size={22} />}
        <span>{sharing ? "Stop share" : "Share"}</span>
      </button>

      <button
        className={`ctrl ${handRaised ? "active" : ""}`}
        onClick={onToggleHand}
        title={handRaised ? "Lower hand (Ctrl+H)" : "Raise hand (Ctrl+H)"}
      >
        <Hand size={22} />
        <span>{handRaised ? "Lower" : "Raise"}</span>
      </button>

      <button
        className={`ctrl ${reactionsOpen ? "active" : ""}`}
        onClick={onToggleReactions}
        title="Send a reaction"
      >
        <Smile size={22} />
        <span>React</span>
      </button>

      <button
        className={`ctrl ${participantsOpen ? "active" : ""}`}
        onClick={onToggleParticipants}
        title="Participants"
      >
        <Users size={22} />
        <span>People {participantCount > 0 && `(${participantCount})`}</span>
      </button>

      <button
        className={`ctrl ${chatOpen ? "active" : ""}`}
        onClick={onToggleChat}
        title="Chat"
      >
        <MessageSquare size={22} />
        {unreadCount > 0 && <span className="badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
        <span>Chat</span>
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
        className={`ctrl ${settingsOpen ? "active" : ""}`}
        onClick={onToggleSettings}
        title="Settings"
      >
        <SettingsIcon size={22} />
        <span>Settings</span>
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
