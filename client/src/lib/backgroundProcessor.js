import { SelfieSegmentation } from "@mediapipe/selfie_segmentation";

/**
 * BackgroundProcessor
 * -------------------
 * Takes a raw camera video track and produces a NEW video track (via a canvas)
 * with an optional virtual background:
 *   - "none"  : passthrough (camera drawn 1:1)
 *   - "blur"  : real background blurred, person kept sharp
 *   - "image" : real background replaced by a chosen image
 *
 * We always output the canvas track so switching effects never requires a
 * WebRTC renegotiation — we just change what gets drawn each frame.
 *
 * If the ML model fails to load (older browser, network issue), it degrades
 * gracefully to passthrough so the call still works.
 */
export class BackgroundProcessor {
  constructor() {
    this.effect = "none"; // none | blur | image
    this.bgImage = null; // HTMLImageElement for "image" effect
    this.ready = false;
    this.running = false;
    this.rafId = null;

    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");

    this.segmentation = null;
    this._lastResults = null;
    this._enabled = true; // mirrors camera on/off
  }

  async init() {
    try {
      this.segmentation = new SelfieSegmentation({
        // Assets are copied into /mediapipe by vite-plugin-static-copy.
        locateFile: (file) => `${import.meta.env.BASE_URL || "/"}mediapipe/${file}`,
      });
      this.segmentation.setOptions({ modelSelection: 1 });
      this.segmentation.onResults((results) => this._onResults(results));
      this.ready = true;
    } catch (err) {
      console.warn("Segmentation init failed — backgrounds disabled:", err);
      this.ready = false;
    }
  }

  // Start processing a camera video track; returns the processed MediaStream.
  async start(cameraTrack) {
    const stream = new MediaStream([cameraTrack]);
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});

    const settings = cameraTrack.getSettings();
    this.canvas.width = settings.width || 1280;
    this.canvas.height = settings.height || 720;

    this.running = true;
    this._loop();

    // captureStream produces frames as the canvas is redrawn.
    this.outputStream = this.canvas.captureStream(30);
    return this.outputStream;
  }

  setEffect(effect, image = null) {
    this.effect = effect;
    this.bgImage = image;
  }

  setEnabled(enabled) {
    this._enabled = enabled;
  }

  async _loop() {
    if (!this.running) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Camera off → paint a neutral placeholder instead of a frozen frame.
    if (!this._enabled) {
      this.ctx.fillStyle = "#111318";
      this.ctx.fillRect(0, 0, w, h);
    } else if (this.effect === "none" || !this.ready) {
      // Passthrough: draw the raw camera frame.
      this.ctx.drawImage(this.video, 0, 0, w, h);
    } else {
      // Run segmentation; compositing happens in _onResults.
      try {
        await this.segmentation.send({ image: this.video });
      } catch (err) {
        // On any failure, fall back to passthrough this frame.
        this.ctx.drawImage(this.video, 0, 0, w, h);
      }
    }

    this.rafId = requestAnimationFrame(() => this._loop());
  }

  _onResults(results) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // 1. Draw the segmentation mask.
    ctx.drawImage(results.segmentationMask, 0, 0, w, h);

    // 2. Keep only the person (pixels where the mask is present).
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(results.image, 0, 0, w, h);

    // 3. Draw the background BEHIND the person.
    ctx.globalCompositeOperation = "destination-over";
    if (this.effect === "blur") {
      ctx.filter = "blur(12px)";
      ctx.drawImage(results.image, 0, 0, w, h);
      ctx.filter = "none";
    } else if (this.effect === "image" && this.bgImage) {
      this._drawCover(this.bgImage, w, h);
    } else {
      // No/invalid image → just show the plain camera behind.
      ctx.drawImage(results.image, 0, 0, w, h);
    }

    ctx.restore();
  }

  // Draw an image with object-fit: cover behavior.
  _drawCover(img, w, h) {
    const iw = img.width || w;
    const ih = img.height || h;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    this.ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.outputStream?.getTracks().forEach((t) => t.stop());
    try {
      this.segmentation?.close();
    } catch {
      // ignore
    }
    this.video.srcObject = null;
  }
}
