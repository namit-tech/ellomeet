/**
 * The virtual-background effect, as a LiveKit TrackProcessor.
 *
 * WHY THIS EXISTS. The previous arrangement piped *every* camera through the
 * MediaPipe canvas pipeline, whether or not an effect was selected. Two costs,
 * both paid by everyone:
 *
 *   - a requestAnimationFrame loop copying every frame to a canvas, forever,
 *     for the ~95% of users who never touch backgrounds
 *   - MediaPipe's model and wasm in the critical path of joining a call
 *
 * As a processor, the raw camera is published directly and this is attached
 * only when someone actually picks blur or an image — and detached the moment
 * they pick "none". LiveKit swaps the underlying MediaStreamTrack on the
 * existing publication, so there is no renegotiation and nobody sees a gap.
 *
 * The module is imported dynamically (see useLiveKit.setBackground), which
 * keeps MediaPipe out of the initial bundle entirely.
 */
export class BackgroundTrackProcessor {
  constructor(effect, image) {
    this.name = 'virtual-background';
    this.effect = effect; // blur | image
    this.image = image;
    this.processor = null;
  }

  async init(opts) {
    // Imported here rather than at module scope so the segmentation model is
    // only fetched when an effect is genuinely used.
    const { BackgroundProcessor } = await import('./BackgroundProcessor.js');

    this.processor = new BackgroundProcessor();
    await this.processor.init();
    this.processor.setEffect(this.effect, this.image);

    const stream = await this.processor.start(opts.track);
    this.processedTrack = stream.getVideoTracks()[0];
  }

  /** Called when the source changes — e.g. the user switched camera. */
  async restart(opts) {
    if (!this.processor) return this.init(opts);
    const stream = await this.processor.start(opts.track);
    this.processedTrack = stream.getVideoTracks()[0];
  }

  /** Change effect without tearing the pipeline down and back up. */
  setEffect(effect, image = null) {
    this.effect = effect;
    this.image = image;
    this.processor?.setEffect(effect, image);
  }

  setEnabled(enabled) {
    this.processor?.setEnabled(enabled);
  }

  async destroy() {
    this.processor?.stop();
    this.processor = null;
    this.processedTrack = undefined;
  }
}
