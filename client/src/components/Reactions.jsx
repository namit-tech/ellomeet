export const REACTIONS = ["👍", "👏", "❤️", "😂", "🎉", "😮", "👋"];

/**
 * ReactionOverlay — the emoji everyone sends float up over the call.
 * Each one is removed by the hook after its animation is done.
 */
export function ReactionOverlay({ reactions }) {
  return (
    <div className="reaction-layer">
      {reactions.map((r) => (
        <div
          key={r.key}
          className="reaction-float"
          // Scatter them horizontally so simultaneous reactions don't overlap.
          style={{ left: `${10 + (hash(r.key) % 80)}%` }}
        >
          <span className="reaction-emoji">{r.emoji}</span>
          <span className="reaction-name">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

// ReactionPicker — the little tray above the toolbar.
export function ReactionPicker({ onPick, onClose }) {
  return (
    <div className="reaction-picker">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          className="reaction-btn"
          onClick={() => {
            onPick(emoji);
            onClose();
          }}
          aria-label={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
