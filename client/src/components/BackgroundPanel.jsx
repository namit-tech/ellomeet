import { useRef, useState } from "react";
import { Ban, Sparkles, ImagePlus, X, Check } from "lucide-react";
import { getPresets, getPresetImage, loadImageFromFile } from "../model/backgrounds.js";

// Panel to choose a virtual background: none, blur, presets, or an upload.
export default function BackgroundPanel({ onSelect, onClose, disabled, active }) {
  const presets = getPresets();
  const fileRef = useRef(null);
  const [uploads, setUploads] = useState([]); // { id, img }

  function choose(key, effect, image) {
    onSelect(key, effect, image);
  }

  async function onFiles(e) {
    const files = [...e.target.files];
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const img = await loadImageFromFile(file);
        const id = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        setUploads((u) => [...u, { id, img }]);
        choose(id, "image", img);
      } catch {
        /* ignore bad images */
      }
    }
    e.target.value = "";
  }

  return (
    <aside className="bg-panel">
      <div className="bg-panel-header">
        <span>Background</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      {disabled && (
        <p className="bg-note">
          Background effects couldn’t load in this browser. Try Chrome or Edge.
        </p>
      )}

      <div className="bg-grid">
        {/* None */}
        <button
          className={`bg-swatch ${active === "none" ? "sel" : ""}`}
          onClick={() => choose("none", "none")}
        >
          <div className="bg-swatch-plain"><Ban size={20} /></div>
          <span>None</span>
          {active === "none" && <Check className="bg-check" size={16} />}
        </button>

        {/* Blur */}
        <button
          className={`bg-swatch ${active === "blur" ? "sel" : ""}`}
          onClick={() => choose("blur", "blur")}
          disabled={disabled}
        >
          <div className="bg-swatch-blur"><Sparkles size={20} /></div>
          <span>Blur</span>
          {active === "blur" && <Check className="bg-check" size={16} />}
        </button>

        {/* Presets */}
        {presets.map((p) => (
          <button
            key={p.id}
            className={`bg-swatch ${active === p.id ? "sel" : ""}`}
            onClick={() => choose(p.id, "image", getPresetImage(p.id))}
            disabled={disabled}
          >
            <img className="bg-swatch-img" src={getPresetImage(p.id)?.src} alt={p.label} />
            <span>{p.label}</span>
            {active === p.id && <Check className="bg-check" size={16} />}
          </button>
        ))}

        {/* Uploaded images */}
        {uploads.map((u) => (
          <button
            key={u.id}
            className={`bg-swatch ${active === u.id ? "sel" : ""}`}
            onClick={() => choose(u.id, "image", u.img)}
            disabled={disabled}
          >
            <img className="bg-swatch-img" src={u.img.src} alt="Custom background" />
            <span>Yours</span>
            {active === u.id && <Check className="bg-check" size={16} />}
          </button>
        ))}

        {/* Upload button */}
        <button
          className="bg-swatch upload"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <div className="bg-swatch-plain"><ImagePlus size={20} /></div>
          <span>Upload</span>
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={onFiles}
      />
    </aside>
  );
}
