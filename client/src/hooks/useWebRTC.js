import { useEffect, useRef, useState, useCallback } from "react";
import { connectSocket, socket } from "../lib/socket.js";
import { iceServers as FALLBACK_ICE_SERVERS } from "../lib/iceServers.js";
import { BackgroundProcessor } from "../lib/backgroundProcessor.js";

/**
 * useWebRTC — manages a full-mesh WebRTC call for a small room (2-4 people),
 * plus a virtual-background processor on the local camera.
 *
 * Signaling rule that avoids "glare" (both sides making offers at once):
 * the person who JOINS LATER initiates the offer to everyone already present.
 */
export function useWebRTC({ roomId, name }) {
  const [localStream, setLocalStream] = useState(null);
  const [peers, setPeers] = useState({}); // id -> { name, stream }
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState("connecting"); // connecting | connected | full | error
  const [bgReady, setBgReady] = useState(false);

  const pcsRef = useRef({}); // id -> RTCPeerConnection
  const localStreamRef = useRef(null); // combined stream sent to peers (processed video + audio)
  const rawStreamRef = useRef(null); // untouched camera+mic from getUserMedia
  const processorRef = useRef(null);
  const camVideoTrackRef = useRef(null); // the processed video track (restored after screen share)

  // ICE servers (STUN/TURN) delivered by the signaling server on connect.
  const iceServersRef = useRef(FALLBACK_ICE_SERVERS);
  const iceReceivedRef = useRef(false);
  const iceReadyResolveRef = useRef(null);

  // Have we completed our first join? Used to re-join on reconnect.
  const hasJoinedRef = useRef(false);

  // --- peer connection helpers --------------------------------------------

  const createPeerConnection = useCallback((peerId, peerName) => {
    if (pcsRef.current[peerId]) return pcsRef.current[peerId];

    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    pcsRef.current[peerId] = pc;

    const stream = localStreamRef.current;
    if (stream) stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit("ice-candidate", { to: peerId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      const [remoteStream] = e.streams;
      setPeers((prev) => ({
        ...prev,
        [peerId]: { name: peerName || prev[peerId]?.name || "Guest", stream: remoteStream },
      }));
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
    setPeers((prev) => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, []);

  // Replace the outgoing video track on every peer connection.
  const replaceVideoForAll = useCallback((track) => {
    Object.values(pcsRef.current).forEach((pc) => {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(track);
    });
  }, []);

  // --- main effect: acquire media + processor + signaling ------------------

  useEffect(() => {
    let cancelled = false;

    async function start() {
      let rawStream;
      try {
        rawStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
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

      // Spin up the virtual-background processor (degrades to passthrough).
      const processor = new BackgroundProcessor();
      processorRef.current = processor;
      await processor.init();
      setBgReady(processor.ready);

      let videoTrack = cameraTrack;
      try {
        const processed = await processor.start(cameraTrack);
        videoTrack = processed.getVideoTracks()[0] || cameraTrack;
      } catch (err) {
        console.warn("Processor start failed, using raw camera:", err);
      }
      camVideoTrackRef.current = videoTrack;

      const combined = new MediaStream([videoTrack, audioTrack]);
      localStreamRef.current = combined;
      setLocalStream(combined);
      setStatus("connected");

      connectSocket();

      // Wait briefly for the server to send TURN credentials before joining,
      // so the very first peer connection already has them. Fall back after 2.5s.
      if (!iceReceivedRef.current) {
        await new Promise((resolve) => {
          iceReadyResolveRef.current = resolve;
          setTimeout(resolve, 2500);
        });
      }

      socket.emit("join", { roomId, name });
      hasJoinedRef.current = true;
    }

    // --- signaling handlers ---

    const onPeers = async ({ peers: existing }) => {
      for (const p of existing) {
        const pc = createPeerConnection(p.id, p.name);
        setPeers((prev) => ({ ...prev, [p.id]: { name: p.name, stream: null, ...prev[p.id] } }));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { to: p.id, sdp: offer });
      }
    };

    const onPeerJoined = ({ id, name: peerName }) => {
      setPeers((prev) => ({ ...prev, [id]: { name: peerName, stream: null, ...prev[id] } }));
    };

    const onOffer = async ({ from, sdp, name: peerName }) => {
      const pc = createPeerConnection(from, peerName);
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

    const onPeerLeft = ({ id }) => closePeer(id);
    const onRoomFull = () => setStatus("full");
    const onChat = (msg) => setMessages((prev) => [...prev, msg]);

    // TURN/STUN list from the server. Apply it and unblock join if waiting.
    const onIceServers = ({ iceServers: list }) => {
      if (Array.isArray(list) && list.length) iceServersRef.current = list;
      iceReceivedRef.current = true;
      iceReadyResolveRef.current?.();
    };

    // On reconnect the socket gets a NEW id, so our old peer connections are
    // stale. Tear them down and re-join the room; the server then re-shares the
    // current members and everyone rebuilds connections. (The initial connect
    // is handled by start(), guarded by hasJoinedRef.)
    const onConnect = () => {
      if (!hasJoinedRef.current) return;
      Object.keys(pcsRef.current).forEach(closePeer);
      socket.emit("join", { roomId, name });
    };

    socket.on("connect", onConnect);
    socket.on("ice-servers", onIceServers);
    socket.on("peers", onPeers);
    socket.on("peer-joined", onPeerJoined);
    socket.on("offer", onOffer);
    socket.on("answer", onAnswer);
    socket.on("ice-candidate", onIceCandidate);
    socket.on("peer-left", onPeerLeft);
    socket.on("room-full", onRoomFull);
    socket.on("chat", onChat);

    start();

    return () => {
      cancelled = true;
      socket.off("connect", onConnect);
      socket.off("ice-servers", onIceServers);
      socket.off("peers", onPeers);
      socket.off("peer-joined", onPeerJoined);
      socket.off("offer", onOffer);
      socket.off("answer", onAnswer);
      socket.off("ice-candidate", onIceCandidate);
      socket.off("peer-left", onPeerLeft);
      socket.off("room-full", onRoomFull);
      socket.off("chat", onChat);

      socket.emit("leave");
      Object.keys(pcsRef.current).forEach(closePeer);
      processorRef.current?.stop();
      rawStreamRef.current?.getTracks().forEach((t) => t.stop());
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name]);

  // --- controls ------------------------------------------------------------

  const toggleAudio = useCallback(() => {
    const track = rawStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      return track.enabled;
    }
    return false;
  }, []);

  const toggleVideo = useCallback(() => {
    const track = rawStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      processorRef.current?.setEnabled(track.enabled);
      return track.enabled;
    }
    return false;
  }, []);

  // Screen share: send the raw display track directly (bypasses background),
  // then restore the processed camera track when it ends.
  const shareScreen = useCallback(async () => {
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = displayStream.getVideoTracks()[0];

      replaceVideoForAll(screenTrack);
      setLocalStream(new MediaStream([screenTrack, rawStreamRef.current.getAudioTracks()[0]]));

      screenTrack.onended = () => {
        const restore = camVideoTrackRef.current;
        replaceVideoForAll(restore);
        setLocalStream(new MediaStream([restore, rawStreamRef.current.getAudioTracks()[0]]));
      };
    } catch (err) {
      console.warn("Screen share cancelled/failed:", err);
    }
  }, [replaceVideoForAll]);

  // Change the virtual background: effect = "none" | "blur" | "image".
  const setBackground = useCallback((effect, image = null) => {
    processorRef.current?.setEffect(effect, image);
  }, []);

  const sendChat = useCallback((text) => {
    socket.emit("chat", { text });
  }, []);

  return {
    localStream,
    peers,
    messages,
    status,
    bgReady,
    toggleAudio,
    toggleVideo,
    shareScreen,
    setBackground,
    sendChat,
  };
}
