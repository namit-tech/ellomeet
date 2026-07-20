const FALLBACK_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * MeshConnection — every RTCPeerConnection in the call.
 *
 * Full mesh: each participant holds one connection to every other participant.
 * That's why the room is capped at 4 — you upload a separate stream per peer,
 * so upstream cost grows with the room. Going bigger means an SFU, and this is
 * the class that would be replaced.
 *
 * Glare (both sides offering at once) is avoided by a single rule enforced by
 * the caller: whoever JOINS LATER sends the offers.
 */
export class MeshConnection {
  /**
   * @param {object} opts
   * @param {SignalingClient} opts.signaling
   * @param {() => MediaStream|null} opts.getLocalStream  what we're sending RIGHT NOW
   * @param {(id, stream) => void} opts.onRemoteStream
   */
  constructor({ signaling, getLocalStream, onRemoteStream }) {
    this.signaling = signaling;
    this.getLocalStream = getLocalStream;
    this.onRemoteStream = onRemoteStream;

    this.iceServers = FALLBACK_ICE;
    this.peers = new Map(); // id -> RTCPeerConnection
    // Explicit sender handles. Searching getSenders() by track.kind misses a
    // sender whose track was already replaced or ended — which is exactly the
    // state you're in mid screen-share.
    this.senders = new Map(); // id -> { audio, video }
    this.statsPrev = new Map(); // id -> { lost, received }
  }

  setIceServers(servers) {
    if (Array.isArray(servers) && servers.length) this.iceServers = servers;
  }

  get(id) {
    return this.peers.get(id) || null;
  }

  create(id) {
    const existing = this.peers.get(id);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    this.peers.set(id, pc);

    // Send whatever we are sending right now — if a share is already running
    // when this peer arrives, that's the screen, not the camera.
    const stream = this.getLocalStream();
    if (stream) {
      const senders = {};
      for (const track of stream.getTracks()) {
        senders[track.kind] = pc.addTrack(track, stream);
      }
      this.senders.set(id, senders);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.iceCandidate(id, e.candidate.toJSON());
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      if (remoteStream) this.onRemoteStream(id, remoteStream);
    };

    return pc;
  }

  async offerTo(id) {
    const pc = this.create(id);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signaling.offer(id, { type: offer.type, sdp: offer.sdp });
  }

  async acceptOffer(from, sdp) {
    const pc = this.create(from);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling.answer(from, { type: answer.type, sdp: answer.sdp });
  }

  async acceptAnswer(from, sdp) {
    const pc = this.peers.get(from);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  }

  async addIceCandidate(from, candidate) {
    const pc = this.peers.get(from);
    if (!pc || !candidate) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn("addIceCandidate failed:", err);
    }
  }

  /**
   * Swap one outgoing track on every connection — the whole basis of screen
   * sharing and device switching. replaceTrack needs no renegotiation, so the
   * far side just starts seeing different pixels.
   */
  replaceTrack(kind, track) {
    for (const id of this.peers.keys()) {
      const sender = this.senders.get(id)?.[kind];
      if (sender) sender.replaceTrack(track).catch((e) => console.warn("replaceTrack:", e));
    }
  }

  close(id) {
    const pc = this.peers.get(id);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      this.peers.delete(id);
    }
    this.senders.delete(id);
    this.statsPrev.delete(id);
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id);
  }

  /**
   * Packet loss since the last sample, plus round-trip time — the numbers
   * behind the "weak connection" badge.
   * @returns {Promise<Object<string, "good"|"ok"|"poor">>}
   */
  async sampleQuality() {
    const result = {};

    for (const [id, pc] of this.peers) {
      if (pc.connectionState !== "connected") {
        result[id] = "poor";
        continue;
      }

      try {
        const stats = await pc.getStats();
        let lost = 0;
        let received = 0;
        let rtt = 0;

        stats.forEach((report) => {
          if (report.type === "inbound-rtp") {
            lost += report.packetsLost || 0;
            received += report.packetsReceived || 0;
          }
          if (
            report.type === "candidate-pair" &&
            report.state === "succeeded" &&
            report.currentRoundTripTime
          ) {
            rtt = Math.max(rtt, report.currentRoundTripTime);
          }
        });

        const prev = this.statsPrev.get(id) || { lost: 0, received: 0 };
        const dLost = Math.max(0, lost - prev.lost);
        const dReceived = Math.max(0, received - prev.received);
        this.statsPrev.set(id, { lost, received });

        const total = dLost + dReceived;
        const lossRate = total > 0 ? dLost / total : 0;

        if (lossRate > 0.08 || rtt > 0.4) result[id] = "poor";
        else if (lossRate > 0.02 || rtt > 0.2) result[id] = "ok";
        else result[id] = "good";
      } catch {
        result[id] = "ok";
      }
    }

    return result;
  }
}
