import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Sun, Moon, ArrowRight } from "lucide-react";
import { useTheme } from "./hooks/useTheme.js";
import { createRoom as mintRoom } from "./model/socket.js";

// Landing page: pick a name and create or join a room.
export default function App() {
  const { tenant } = useParams(); // undefined at "/", set under /t/<tenant>
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [passcode, setPasscode] = useState("");
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  // A room's URL keeps its tenant, so a shared link lands in the same namespace.
  function roomPath(c) {
    const enc = encodeURIComponent(c);
    return tenant ? `/t/${encodeURIComponent(tenant)}/room/${enc}` : `/room/${enc}`;
  }

  function go(c) {
    const trimmed = (c || "").trim();
    if (!trimmed) return;
    sessionStorage.setItem("meet:name", name.trim() || "Guest");
    navigate(roomPath(trimmed));
  }

  // The server mints the code — the client no longer invents one, which is what
  // stops anyone from choosing a guessable id like `001`.
  async function createRoom() {
    if (creating) return;
    setCreating(true);
    try {
      const room = await mintRoom({ tenant, passcode: passcode.trim() || undefined });
      go(room.code);
    } catch (err) {
      console.error("Could not create a meeting:", err);
      alert("Couldn't create a meeting. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
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

        <label>
          Passcode <span className="label-hint">(optional)</span>
          <input
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Guests will need this to join"
            maxLength={64}
          />
        </label>

        <button className="btn primary" onClick={createRoom} disabled={creating}>
          <Plus size={18} /> {creating ? "Creating…" : "New meeting"}
        </button>

        <div className="divider"><span>or join with a code</span></div>

        <div className="join-row">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Room code"
            onKeyDown={(e) => e.key === "Enter" && go(code)}
          />
          <button className="btn" onClick={() => go(code)} aria-label="Join">
            <ArrowRight size={18} />
          </button>
        </div>
      </div>

      <p className="footer-hint">
        {tenant ? `${tenant} · ` : ""}No sign-up · No downloads · Up to 20 people
      </p>
    </div>
  );
}
