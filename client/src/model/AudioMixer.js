/**
 * AudioMixer — merges several audio tracks into ONE outgoing track.
 *
 * Used for screen sharing with system audio: WebRTC senders carry a single
 * audio track each, and adding a second one would force a renegotiation on
 * every peer. Instead we mix mic + tab/system audio through a Web Audio graph
 * and hand the result to `sender.replaceTrack()`.
 *
 * Muting still works: a disabled MediaStreamTrack feeds silence into the graph,
 * so `track.enabled = false` on the mic silences it inside the mix too.
 */
export class AudioMixer {
  constructor() {
    this.ctx = null;
    this.dest = null;
    this.sources = [];
  }

  // Mix the given tracks and return the single combined output track.
  mix(tracks) {
    this.stop();

    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    this.dest = this.ctx.createMediaStreamDestination();

    for (const track of tracks.filter(Boolean)) {
      const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
      source.connect(this.dest);
      this.sources.push(source);
    }

    return this.dest.stream.getAudioTracks()[0] || null;
  }

  get active() {
    return !!this.ctx;
  }

  stop() {
    this.sources.forEach((s) => s.disconnect());
    this.sources = [];
    this.dest = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
