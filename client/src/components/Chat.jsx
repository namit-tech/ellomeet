import { useEffect, useRef, useState } from "react";
import { X, Send } from "lucide-react";

/**
 * Chat — relayed through the signaling server, which also keeps the last 200
 * messages so someone joining late doesn't walk into an empty transcript.
 * System lines ("Amit joined", "Meeting locked") arrive on the same channel.
 */
export default function Chat({ messages, selfId, onSend, onClose }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  }

  return (
    <aside className="panel chat">
      <div className="panel-header">
        <span>Chat</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close chat">
          <X size={18} />
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && <p className="panel-note">No messages yet.</p>}

        {messages.map((m, i) => {
          if (m.system) {
            return (
              <div key={i} className="chat-system">
                {m.text}
              </div>
            );
          }
          const mine = m.id === selfId;
          return (
            <div key={i} className={`chat-msg ${mine ? "mine" : ""}`}>
              <div className="chat-meta">
                <strong>{mine ? "You" : m.name}</strong>
                <time>{formatTime(m.ts)}</time>
              </div>
              <span>{m.text}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
          maxLength={2000}
        />
        <button className="icon-btn send" type="submit" aria-label="Send">
          <Send size={18} />
        </button>
      </form>
    </aside>
  );
}

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
