import { BackgroundProcessor } from "./BackgroundProcessor.js";

/**
 * LocalMedia — your camera and microphone, and the virtual-background pipeline
 * sitting on top of the camera.
 *
 * Owns the distinction that causes most of the subtle bugs here:
 *   - the RAW camera/mic tracks (what `enabled = false` must be applied to), and
 *   - the OUTGOING video track, which is normally the processor's canvas track,
 *     not the camera track at all.
 *
 * Muting has to act on the raw track: a disabled track is what actually stops
 * bytes leaving the machine.
 */
export class LocalMedia {
  constructor() {
    this.raw = null; // MediaStream: real camera + mic
    this.processor = null;
    this.usingProcessor = false;
    this.cameraTrack = null; // outgoing video (processed, or raw on fallback)
    this.backgroundReady = false;
  }

  async start({ audio = true, video = true, audioDeviceId, videoDeviceId } = {}) {
    this.raw = await navigator.mediaDevices.getUserMedia({
      video: videoDeviceId ? { deviceId: { exact: videoDeviceId } } : true,
      audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
    });

    const camera = this.raw.getVideoTracks()[0];
    const mic = this.raw.getAudioTracks()[0];

    // Honour the choices made on the pre-join screen before anything is sent.
    if (mic) mic.enabled = audio;
    if (camera) camera.enabled = video;

    this.processor = new BackgroundProcessor();
    await this.processor.init();
    this.backgroundReady = this.processor.ready;
    this.processor.setEnabled(video);

    this.cameraTrack = camera;
    try {
      const processed = await this.processor.start(camera);
      const track = processed?.getVideoTracks()[0];
      if (track) {
        this.cameraTrack = track;
        this.usingProcessor = true;
      }
    } catch (err) {
      // Segmentation is a nice-to-have; the call matters more.
      console.warn("Background processor failed, using the raw camera:", err);
    }

    return this.stream();
  }

  // What we hand to the peer connections.
  stream() {
    return new MediaStream([this.cameraTrack, this.micTrack].filter(Boolean));
  }

  get micTrack() {
    return this.raw?.getAudioTracks()[0] || null;
  }

  get rawCameraTrack() {
    return this.raw?.getVideoTracks()[0] || null;
  }

  /** @returns {boolean} the new enabled state */
  toggleAudio() {
    const track = this.micTrack;
    if (!track) return false;
    track.enabled = !track.enabled;
    return track.enabled;
  }

  toggleVideo() {
    const track = this.rawCameraTrack;
    if (!track) return false;
    track.enabled = !track.enabled;
    // Paint a placeholder instead of freezing on the last frame.
    this.processor?.setEnabled(track.enabled);
    return track.enabled;
  }

  setBackground(effect, image = null) {
    this.processor?.setEffect(effect, image);
  }

  /**
   * Point the camera at a different device.
   *
   * When the processor is running the outgoing track is the canvas, so swapping
   * the source changes nothing downstream — no replaceTrack, no renegotiation.
   * Only the fallback path needs the new track pushed to the peers.
   *
   * @returns {MediaStreamTrack|null} a new outgoing track, or null if unchanged
   */
  async switchCamera(deviceId) {
    if (!this.raw) return null;

    const next = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
    });
    const track = next.getVideoTracks()[0];

    const old = this.rawCameraTrack;
    track.enabled = old ? old.enabled : true;
    if (old) {
      old.stop();
      this.raw.removeTrack(old);
    }
    this.raw.addTrack(track);

    if (this.usingProcessor) {
      await this.processor.start(track); // swaps the source, same canvas
      return null;
    }

    this.cameraTrack = track;
    return track;
  }

  /** @returns {MediaStreamTrack} the new mic track (callers must re-send it) */
  async switchMic(deviceId) {
    const next = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
    });
    const track = next.getAudioTracks()[0];

    const old = this.micTrack;
    track.enabled = old ? old.enabled : true;
    if (old) {
      old.stop();
      this.raw.removeTrack(old);
    }
    this.raw.addTrack(track);

    return track;
  }

  stop() {
    this.processor?.stop();
    this.raw?.getTracks().forEach((t) => t.stop());
    this.raw = null;
  }
}
