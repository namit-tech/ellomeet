// Built-in background presets. To stay fully self-contained (no external image
// downloads), the presets are generated as gradients/solids onto an offscreen
// canvas and cached as HTMLImageElements ready for compositing.

const CACHE = new Map(); // id -> HTMLImageElement

const W = 1280;
const H = 720;

// Definition of each preset: id, label, and a paint(ctx) function.
const PRESETS = [
  {
    id: "office-blue",
    label: "Blue",
    paint: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#1e3a8a");
      g.addColorStop(1, "#2563eb");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: "warm-sunset",
    label: "Sunset",
    paint: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#f97316");
      g.addColorStop(0.5, "#db2777");
      g.addColorStop(1, "#7c3aed");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: "forest",
    label: "Forest",
    paint: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#064e3b");
      g.addColorStop(1, "#10b981");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: "slate",
    label: "Slate",
    paint: (ctx) => {
      const g = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, W);
      g.addColorStop(0, "#334155");
      g.addColorStop(1, "#0f172a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
  },
  {
    id: "clean-white",
    label: "White",
    paint: (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(1, "#e2e8f0");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    },
  },
];

export function getPresets() {
  return PRESETS.map(({ id, label }) => ({ id, label }));
}

// Return (and cache) the rendered image for a preset id.
export function getPresetImage(id) {
  if (CACHE.has(id)) return CACHE.get(id);
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) return null;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  preset.paint(ctx);

  const img = new Image();
  img.src = canvas.toDataURL("image/png");
  CACHE.set(id, img);
  return img;
}

// Turn an uploaded File into a loaded HTMLImageElement (returns a Promise).
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
