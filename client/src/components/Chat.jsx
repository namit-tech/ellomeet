import { useEffect, useRef, useState } from "react";
import { X, Send } from "lucide-react";

// Simple text chat panel; messages are relayed through the signaling server.
export default function Chat({ messages, onSend, onClose }) {
  const [text, setText] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit(e) {
    e.preventDefault();
    if (text.trim()) {
      onSend(text.trim());
      setText("");
    }
  }

  return (
    <aside className="chat">
      <div className="chat-header">
        <span>Chat</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close chat">
          <X size={18} />
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && <p className="chat-empty">No messages yet.</p>}
        {messages.map((m, i) => (
          <div key={i} className="chat-msg">
            <strong>{m.name}</strong>
            <span>{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message…"
        />
        <button className="icon-btn send" type="submit" aria-label="Send">
          <Send size={18} />
        </button>
      </form>
    </aside>
  );
}
