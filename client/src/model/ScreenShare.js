import { AudioMixer } from "./AudioMixer.js";

/**
 * ScreenShare — presenting your screen to the room.
 *
 * The three things that make this fiddly, all handled here:
 *
 *  1. The share replaces the outgoing VIDEO track. Anything that caches "the
 *     stream we send" must be updated too, or a peer who joins mid-share gets
 *     your camera instead of your screen. (That was the original bug.)
 *  2. A peer connection has ONE audio sender. Adding system audio as a second
 *     track would renegotiate every peer, so mic + system audio are mixed into
 *     a single track instead.
 *  3. The browser's own "Stop sharing" bar ends the track behind our back, so
 *     stopping must be driven by the track's `ended` event, not only the button.
 */
export class ScreenShare {
  constructor({ mesh, media, onChange }) {
    this.mesh = mesh;
    this.media = media;
    this.onChange = onChange; // (sharing: boolean) => void
    this.mixer = new AudioMixer();
    this.stream = null;
  }

  get active() {
    return !!this.stream;
  }

  /** @returns {MediaStream|null} the new outgoing stream, or null if cancelled */
  async start() {
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true, // tab / system audio, where the browser offers it
      });
    } catch (err) {
      // The user dismissed the picker. Not an error.
      console.warn("Screen share cancelled:", err);
      return null;
    }

    this.stream = display;

    const screenTrack = display.getVideoTracks()[0];
    // Tell the encoder this is a screen: keep text legible rather than chasing
    // frame rate, and don't starve the stream while the screen is static.
    screenTrack.contentHint = "detail";

    const screenAudio = display.getAudioTracks()[0];
    const mic = this.media.micTrack;

    // One audio sender per peer → mix rather than add a track.
    const outgoingAudio = screenAudio ? this.mixer.mix([mic, screenAudio]) || mic : mic;

    this.mesh.replaceTrack("video", screenTrack);
    if (screenAudio) this.mesh.replaceTrack("audio", outgoingAudio);

    screenTrack.addEventListener("ended", () => this.stop());

    this.onChange(true);
    return new MediaStream([screenTrack, outgoingAudio].filter(Boolean));
  }

  /** @returns {MediaStream|null} the restored camera stream, or null if not sharing */
  stop() {
    if (!this.stream) return null;

    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;

    const camera = this.media.cameraTrack;
    const mic = this.media.micTrack;

    this.mesh.replaceTrack("video", camera);

    // Drop back from the mixed track to the plain mic.
    if (this.mixer.active) {
      this.mixer.stop();
      this.mesh.replaceTrack("audio", mic);
    }

    this.onChange(false);
    return new MediaStream([camera, mic].filter(Boolean));
  }

  // The mic was swapped mid-share, so the mix has to be rebuilt around it.
  rebuildAudio(micTrack) {
    const screenAudio = this.stream?.getAudioTracks()[0];
    if (!screenAudio) return micTrack;
    return this.mixer.mix([micTrack, screenAudio]) || micTrack;
  }

  dispose() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.mixer.stop();
  }
}
