import { useEffect, useRef, useState, useCallback } from "react";
import { connectSocket, socket } from "../lib/socket.js";
import { iceServers as FALLBACK_ICE_SERVERS } from "../lib/iceServers.js";
import { BackgroundProcessor } from "../lib/backgroundProcessor.js";
import { AudioMixer } from "../lib/audioMixer.js";

/**
 * useWebRTC — a full-mesh WebRTC call for a small room (2-4 people).
 *
 * Media is peer-to-peer. The server holds the *roster*: who is here, who is
 * muted, who has a hand up, who is presenting, who is host. Local toggles are
 * therefore always reported back with `emitState` — otherwise nobody else can
 * tell you're muted, they just hear silence.
 *
 * Signaling rule that avoids "glare" (both sides offering at once): whoever
 * JOINS LATER initiates the offer to everyone already present.
 */
export function useWebRTC({ roomId, name, initial }) {
  // Device ids / mute choices made on the pre-join screen. Captured once —
  // later changes go through switchCamera / switchMic.
  const cfgRef = useRef(initial || {});

  const [selfId, setSelfId] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState({}); // id -> { stream }
  const [room, setRoom] = useState({ hostId: null, locked: false, participants: [], waiting: [] });
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]); // transient floating emoji
  const [quality, setQuality] = useState({}); // id -> good | ok | poor
  const [status, setStatus] = useState("connecting");
  // connecting | connected | waiting | full | denied | removed | ended | error
  const [notice, setNotice] = useState(null);
  const [bgReady, setBgReady] = useState(false);

  const [audioOn, setAudioOn] = useState(cfgRef.current.audio ?? true);
  const [videoOn, setVideoOn] = useState(cfgRef.current.video ?? true);
  const [handRaised, setHandRaised] = useState(false);
  const [sharing, setSharing] = useState(false);

  const pcsRef = useRef({}); // id -> RTCPeerConnection
  const sendersRef = useRef({}); // id -> { video: RTCRtpSender, audio: RTCRtpSender }
  const localStreamRef = useRef(null); // exactly what we are sending right now
  const rawStreamRef = useRef(null); // untouched camera + mic from getUserMedia
  const processorRef = useRef(null);
  const usingProcessorRef = useRef(false);
  const camVideoTrackRef = useRef(null); // outgoing camera track (restored after a share)
  const screenStreamRef = useRef(null);
  const mixerRef = useRef(new AudioMixer());
  const statsPrevRef = useRef({});

  const iceServersRef = useRef(FALLBACK_ICE_SERVERS);
  const iceReceivedRef = useRef(false);
  const iceReadyResolveRef = useRef(null);
  const hasJoinedRef = useRef(false);

  // --- helpers -------------------------------------------------------------

  const emitState = useCallback((patch) => socket.emit("state", patch), []);

  const flash = useCallback((text) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 3500);
  }, []);

  // Swap one outgoing track on every peer connection. We keep explicit sender
  // references rather than searching getSenders() by track.kind, because a
  // sender whose track was already replaced or ended is easy to miss that way.
  const replaceTrackForAll = useCallback((kind, track) => {
    Object.keys(pcsRef.current).forEach((id) => {
      const sender = sendersRef.current[id]?.[kind];
      if (sender) sender.replaceTrack(track).catch((e) => console.warn("replaceTrack:", e));
    });
  }, []);

  const createPeerConnection = useCallback((peerId) => {
    if (pcsRef.current[peerId]) return pcsRef.current[peerId];

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcsRef.current[peerId] = pc;

    // Send whatever we are sending RIGHT NOW — which, if a share is already in
    // progress when this peer arrives, is the screen and not the camera.
    const stream = localStreamRef.current;
    if (stream) {
      const senders = {};
      stream.getTracks().forEach((track) => {
        senders[track.kind] = pc.addTrack(track, stream);
      });
      sendersRef.current[peerId] = senders;
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("ice-candidate", { to: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      setPeers((prev) => ({ ...prev, [peerId]: { stream: remoteStream } }));
    };

    return pc;
  }, []);

  const closePeer = useCallback((peerId) => {
    const pc = pcsRef.current[peerId];
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      delete pcsRef.current[peerId];
    }
    delete sendersRef.current[peerId];
    setPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // --- main effect: media + processor + signaling ---------------------------

  useEffect(() => {
    let cancelled = false;

    async function start() {
      const cfg = cfgRef.current;
      let rawStream;
      try {
        rawStream = await navigator.mediaDevices.getUserMedia({
          video: cfg.videoDeviceId ? { deviceId: { exact: cfg.videoDeviceId } } : true,
          audio: cfg.audioDeviceId ? { deviceId: { exact: cfg.audioDeviceId } } : true,
        });
      } catch (err) {
        console.error("getUserMedia failed:", err);
        if (!cancelled) setStatus("error");
        return;
      }
      if (cancelled) {
        rawStream.getTracks().forEach((t) => t.stop());
        return;
      }
      rawStreamRef.current = rawStream;

      const cameraTrack = rawStream.getVideoTracks()[0];
      const audioTrack = rawStream.getAudioTracks()[0];

      // Honour the mute choices made on the pre-join screen.
      if (audioTrack) audioTrack.enabled = cfg.audio ?? true;
      if (cameraTrack) cameraTrack.enabled = cfg.video ?? true;

      const processor = new BackgroundProcessor();
      processorRef.current = processor;
      await processor.init();
      setBgReady(processor.ready);
      processor.setEnabled(cfg.video ?? true);

      let videoTrack = cameraTrack;
      try {
        const processed = await processor.start(cameraTrack);
        videoTrack = processed.getVideoTracks()[0] || cameraTrack;
        usingProcessorRef.current = videoTrack !== cameraTrack;
      } catch (err) {
        console.warn("Processor start failed, using raw camera:", err);
      }
      camVideoTrackRef.current = videoTrack;

      const combined = new MediaStream([videoTrack, audioTrack].filter(Boolean));
      localStreamRef.current = combined;
      setLocalStream(combined);

      connectSocket();

      // Wait briefly for TURN credentials so the very first peer connection
      // already has them; fall back to plain STUN after 2.5s.
      if (!iceReceivedRef.current) {
        await new Promise((resolve) => {
          iceReadyResolveRef.current = resolve;
          setTimeout(resolve, 2500);
        });
      }

      socket.emit("join", {
        roomId,
        name,
        media: { audio: cfg.audio ?? true, video: cfg.video ?? true },
      });
    }

    // --- signaling handlers ---

    const onJoined = async ({ selfId: id, peers: existing, chat }) => {
      setSelfId(id);
      setStatus("connected");
      setMessages(chat || []);
      hasJoinedRef.current = true;

      for (const p of existing) {
        const pc = createPeerConnection(p.id);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { to: p.id, sdp: offer });
      }
    };

    const onOffer = async ({ from, sdp }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("answer", { to: from, sdp: answer });
    };

    const onAnswer = async ({ from, sdp }) => {
      const pc = pcsRef.current[from];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    };

    const onIceCandidate = async ({ from, candidate }) => {
      const pc = pcsRef.current[from];
      if (pc && candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn("addIceCandidate failed:", err);
        }
      }
    };

    const onRoomState = (state) => setRoom(state);
    const onPeerLeft = ({ id }) => closePeer(id);
    const onChat = (msg) => setMessages((prev) => [...prev, msg]);
    const onRoomFull = () => setStatus("full");
    const onWaiting = () => setStatus("waiting");
    const onDenied = () => setStatus("denied");
    const onRemoved = () => setStatus("removed");
    const onEnded = () => setStatus("ended");

    const onReaction = (r) => {
      const key = `${r.id}-${r.ts}-${Math.random()}`;
      setReactions((prev) => [...prev, { ...r, key }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.key !== key)), 4000);
    };

    // The host asked us to mute. We do it ourselves — nobody else can reach
    // into our microphone — and report the new state back to the room.
    const onForceMute = ({ by }) => {
      const track = rawStreamRef.current?.getAudioTracks()[0];
      if (track?.enabled) {
        track.enabled = false;
        setAudioOn(false);
        emitState({ audio: false });
      }
      flash(`${by || "The host"} muted you`);
    };

    const onIceServers = ({ iceServers: list }) => {
      if (Array.isArray(list) && list.length) iceServersRef.current = list;
      iceReceivedRef.current = true;
      iceReadyResolveRef.current?.();
    };

    // On reconnect the socket gets a NEW id, so the old peer connections are
    // stale. Tear them down and re-join; everyone rebuilds from the fresh roster.
    const onConnect = () => {
      if (!hasJoinedRef.current) return;
      Object.keys(pcsRef.current).forEach(closePeer);
      socket.emit("join", { roomId, name, media: { audio: audioOn, video: videoOn } });
    };

    socket.on("connect", onConnect);
    socket.on("ice-servers", onIceServers);
    socket.on("joined", onJoined);
    socket.on("room-state", onRoomState);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("peer-left", onPeerLeft);
    socket.on("room-full", onRoomFull);
    socket.on("waiting", onWaiting);
    socket.on("denied", onDenied);
    socket.on("removed", onRemoved);
    socket.on("meeting-ended", onEnded);
    socket.on("chat", onChat);
    socket.on("reaction", onReaction);
    socket.on("force-mute", onForceMute);

    start();

    return () => {
      cancelled = true;
      socket.off("connect", onConnect);
      socket.off("ice-servers", onIceServers);
      socket.off("joined", onJoined);
      socket.off("room-state", onRoomState);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("peer-left", onPeerLeft);
      socket.off("room-full", onRoomFull);
      socket.off("waiting", onWaiting);
      socket.off("denied", onDenied);
      socket.off("removed", onRemoved);
      socket.off("meeting-ended", onEnded);
      socket.off("chat", onChat);
      socket.off("reaction", onReaction);
      socket.off("force-mute", onForceMute);

      socket.emit("leave");
      Object.keys(pcsRef.current).forEach(closePeer);
      processorRef.current?.stop();
      mixerRef.current.stop();
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name]);

  // --- connection quality ---------------------------------------------------
  // Sampled from getStats: packet loss over the last interval plus round-trip
  // time. Drives the "unstable connection" indicator on each remote tile.

  useEffect(() => {
    if (status !== "connected") return undefined;

    const timer = setInterval(async () => {
      const next = {};

      for (const [id, pc] of Object.entries(pcsRef.current)) {
        if (pc.connectionState !== "connected") {
          next[id] = "poor";
          continue;
        }
        try {
          const stats = await pc.getStats();
          let lost = 0;
          let received = 0;
          let rtt = 0;

          stats.forEach((r) => {
            if (r.type === "inbound-rtp") {
              lost += r.packetsLost || 0;
              received += r.packetsReceived || 0;
            }
            if (r.type === "candidate-pair" && r.state === "succeeded" && r.currentRoundTripTime) {
              rtt = Math.max(rtt, r.currentRoundTripTime);
            }
          });

          const prev = statsPrevRef.current[id] || { lost: 0, received: 0 };
          const dLost = Math.max(0, lost - prev.lost);
          const dRecv = Math.max(0, received - prev.received);
          statsPrevRef.current[id] = { lost, received };

          const lossRate = dLost + dRecv > 0 ? dLost / (dLost + dRecv) : 0;

          if (lossRate > 0.08 || rtt > 0.4) next[id] = "poor";
          else if (lossRate > 0.02 || rtt > 0.2) next[id] = "ok";
          else next[id] = "good";
        } catch {
          next[id] = "ok";
        }
      }

      setQuality(next);
    }, 3000);

    return () => clearInterval(timer);
  }, [status]);

  // --- controls -------------------------------------------------------------

  const toggleAudio = useCallback(() => {
    const track = rawStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setAudioOn(track.enabled);
    emitState({ audio: track.enabled });
  }, [emitState]);

  const toggleVideo = useCallback(() => {
    const track = rawStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    processorRef.current?.setEnabled(track.enabled);
    setVideoOn(track.enabled);
    emitState({ video: track.enabled });
  }, [emitState]);

  const toggleHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev;
      emitState({ hand: next });
      return next;
    });
  }, [emitState]);

  const sendReaction = useCallback((emoji) => socket.emit("reaction", { emoji }), []);

  // --- screen share ---------------------------------------------------------

  const stopShare = useCallback(() => {
    const screen = screenStreamRef.current;
    if (!screen) return;

    screen.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    screenStreamRef.current = null;

    const camTrack = camVideoTrackRef.current;
    const micTrack = rawStreamRef.current?.getAudioTracks()[0];

    replaceTrackForAll("video", camTrack);

    // If system audio was being mixed in, fall back to the plain mic track.
    if (mixerRef.current.active) {
      mixerRef.current.stop();
      replaceTrackForAll("audio", micTrack);
    }

    const restored = new MediaStream([camTrack, micTrack].filter(Boolean));
    localStreamRef.current = restored;
    setLocalStream(restored);
    setSharing(false);
    emitState({ sharing: false });
  }, [replaceTrackForAll, emitState]);

  const startShare = useCallback(async () => {
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true, // tab / system audio, when the browser offers it
      });
    } catch (err) {
      // The user dismissed the picker — nothing worth surfacing.
      console.warn("Screen share cancelled:", err);
      return;
    }

    screenStreamRef.current = display;
    const screenTrack = display.getVideoTracks()[0];
    // Tell the encoder this is a screen: keep text sharp rather than chasing
    // frame rate, and don't starve the stream when the screen is static.
    screenTrack.contentHint = "detail";

    const micTrack = rawStreamRef.current?.getAudioTracks()[0];
    const screenAudio = display.getAudioTracks()[0];

    // Each peer connection has ONE audio sender, so mix mic + system audio
    // instead of adding a second track (which would renegotiate every peer).
    let outgoingAudio = micTrack;
    if (screenAudio) {
      outgoingAudio = mixerRef.current.mix([micTrack, screenAudio]) || micTrack;
    }

    replaceTrackForAll("video", screenTrack);
    if (screenAudio) replaceTrackForAll("audio", outgoingAudio);

    // Keep localStreamRef pointed at what we're actually sending, so anyone who
    // joins DURING the share receives the screen instead of a stale camera track.
    const shared = new MediaStream([screenTrack, outgoingAudio].filter(Boolean));
    localStreamRef.current = shared;
    setLocalStream(shared);
    setSharing(true);
    emitState({ sharing: true });

    // Fires when the user hits the browser's own "Stop sharing" bar.
    screenTrack.onended = () => stopShare();
  }, [replaceTrackForAll, emitState, stopShare]);

  const toggleShare = useCallback(() => {
    if (sharing) stopShare();
    else startShare();
  }, [sharing, startShare, stopShare]);

  // --- device switching -----------------------------------------------------

  const switchCamera = useCallback(
    async (deviceId) => {
      const raw = rawStreamRef.current;
      if (!raw) return;

      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      newTrack.enabled = videoOn;

      const oldTrack = raw.getVideoTracks()[0];
      if (oldTrack) {
        oldTrack.stop();
        raw.removeTrack(oldTrack);
      }
      raw.addTrack(newTrack);

      if (usingProcessorRef.current) {
        // The processor keeps drawing to the same canvas, so the track peers
        // already receive is unchanged — just point it at the new camera.
        await processorRef.current.start(newTrack);
      } else {
        camVideoTrackRef.current = newTrack;
        if (!sharing) {
          replaceTrackForAll("video", newTrack);
          const next = new MediaStream([newTrack, raw.getAudioTracks()[0]].filter(Boolean));
          localStreamRef.current = next;
          setLocalStream(next);
        }
      }
    },
    [videoOn, sharing, replaceTrackForAll]
  );

  const switchMic = useCallback(
    async (deviceId) => {
      const raw = rawStreamRef.current;
      if (!raw) return;

      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const newTrack = newStream.getAudioTracks()[0];
      newTrack.enabled = audioOn;

      const oldTrack = raw.getAudioTracks()[0];
      if (oldTrack) {
        oldTrack.stop();
        raw.removeTrack(oldTrack);
      }
      raw.addTrack(newTrack);

      // Rebuild the mix if a share is feeding system audio through it.
      const screenAudio = screenStreamRef.current?.getAudioTracks()[0];
      const outgoing = screenAudio
        ? mixerRef.current.mix([newTrack, screenAudio]) || newTrack
        : newTrack;

      replaceTrackForAll("audio", outgoing);

      const video = localStreamRef.current?.getVideoTracks()[0];
      const next = new MediaStream([video, outgoing].filter(Boolean));
      localStreamRef.current = next;
      setLocalStream(next);
    },
    [audioOn, replaceTrackForAll]
  );

  // --- host actions ---------------------------------------------------------

  const isHost = !!selfId && room.hostId === selfId;

  const hostMute = useCallback((id) => socket.emit("host:mute", { id }), []);
  const hostRemove = useCallback((id) => socket.emit("host:remove", { id }), []);
  const hostLock = useCallback((locked) => socket.emit("host:lock", { locked }), []);
  const hostAdmit = useCallback((id) => socket.emit("host:admit", { id }), []);
  const hostDeny = useCallback((id) => socket.emit("host:deny", { id }), []);
  const hostEnd = useCallback(() => socket.emit("host:end"), []);

  const setBackground = useCallback((effect, image = null) => {
    processorRef.current?.setEffect(effect, image);
  }, []);

  const sendChat = useCallback((text) => socket.emit("chat", { text }), []);

  return {
    selfId,
    localStream,
    peers,
    room,
    isHost,
    messages,
    reactions,
    quality,
    status,
    notice,
    bgReady,
    audioOn,
    videoOn,
    handRaised,
    sharing,
    toggleAudio,
    toggleVideo,
    toggleHand,
    toggleShare,
    sendReaction,
    switchCamera,
    switchMic,
    setBackground,
    sendChat,
    host: { mute: hostMute, remove: hostRemove, setLocked: hostLock, admit: hostAdmit, deny: hostDeny, end: hostEnd },
  };
}
