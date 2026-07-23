import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Sun, Moon, ArrowRight } from "lucide-react";
import { useTheme } from "./hooks/useTheme.js";

// Landing page: pick a name and create or join a room.
export default function App() {
  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  function go(id) {
    const trimmed = (id || "").trim();
    if (!trimmed) return;
    sessionStorage.setItem("meet:name", name.trim() || "Guest");
    navigate(`/room/${encodeURIComponent(trimmed)}`);
  }

  function createRoom() {
    go(Math.random().toString(36).slice(2, 8));
  }

  return (
    <div className="landing">
      <button className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </button>

      <div className="landing-card">
        <div className="brand">
          <img src="/logo.png" alt="Ello" className="brand-logo" />
          <h1>Ello Meet</h1>
        </div>
        <p className="subtitle">Private group video calls. No sign-up, no downloads.</p>

        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Amit"
            maxLength={30}
          />
        </label>

        <button className="btn primary" onClick={createRoom}>
          <Plus size={18} /> New meeting
        </button>

        <div className="divider"><span>or join with a code</span></div>

        <div className="join-row">
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Room code"
            onKeyDown={(e) => e.key === "Enter" && go(roomId)}
          />
          <button className="btn" onClick={() => go(roomId)} aria-label="Join">
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      <p className="footer-hint">No sign-up · No downloads · Up to 20 people</p>
    </div>
  );
}
