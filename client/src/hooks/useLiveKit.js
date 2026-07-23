import { useCallback, useEffect, useRef, useState } from "react";
import { RoomEvent, Track, ConnectionState } from "livekit-client";
import { connectSocket, socket } from "../model/socket.js";
import { createRoom, publishQualityFor } from "../model/livekitRoom.js";
import { canShareScreen, screenShareUnavailableReason } from "../model/capabilities.js";

/**
 * useLiveKit — the media layer, on an SFU.
 *
 * DIVISION OF RESPONSIBILITY, and it is deliberate:
 *
 *   LiveKit carries media.   Our server carries the rules.
 *
 * The roster, host controls, waiting room, lock, chat and reactions all still
 * run over the existing socket, because they are this product's logic and the
 * SFU has no opinion about them. LiveKit is told nothing except "forward these
 * tracks". The seam between the two is the token, which the server mints only
 * for someone it has actually admitted (see services/livekit.service.js).
 *
 * WHY TRACKS, NOT STREAMS. The mesh version handed MediaStreams to the UI. Here
 * the UI receives LiveKit Track objects and calls track.attach(element),
 * because adaptiveStream watches the attached element to decide which simulcast
 * layer to pull and whether to pause the track at all. Assembling a MediaStream
 * by hand would silently disable the single most important scaling feature.
 */
export function useLiveKit({ roomId, name, initial }) {
  const cfgRef = useRef(initial || {});

  const [selfId, setSelfId] = useState(null);
  const [localCamera, setLocalCamera] = useState(null);
  const [localScreen, setLocalScreen] = useState(null);
  const [peers, setPeers] = useState({}); // id -> { camera, mic, screen, screenAudio }
  const [room, setRoom] = useState({ hostId: null, locked: false, participants: [], waiting: [] });
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);
  const [speaking, setSpeaking] = useState({});
  const [quality, setQuality] = useState({}); // id -> good | ok | poor
  const [maxPeers, setMaxPeers] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [notice, setNotice] = useState(null);
  const [bgReady, setBgReady] = useState(false);

  const [audioOn, setAudioOn] = useState(cfgRef.current.audio ?? true);
  const [videoOn, setVideoOn] = useState(cfgRef.current.video ?? true);
  const [handRaised, setHandRaised] = useState(false);
  const [sharing, setSharing] = useState(false);

  const lkRef = useRef(null);
  const processorRef = useRef(null);
  const publishedCamRef = useRef(null); // what peers actually receive
  const hasJoinedRef = useRef(false);
  const credsTimerRef = useRef(null);

  const emitState = useCallback((patch) => socket.emit("state", patch), []);

  const flash = useCallback((text) => {
    setNotice(text);
    setTimeout(() => setNotice((n) => (n === text ? null : n)), 3500);
  }, []);

  // Rebuild the peer map from LiveKit's own state. Cheap at this size, and far
  // less error-prone than trying to patch a map on every track event.
  const syncPeers = useCallback(() => {
    const lk = lkRef.current;
    if (!lk) return;

    const next = {};
    for (const [identity, p] of lk.remoteParticipants) {
      const entry = { camera: null, mic: null, screen: null, screenAudio: null };
      for (const pub of p.trackPublications.values()) {
        if (!pub.track) continue;
        if (pub.source === Track.Source.Camera) entry.camera = pub.track;
        else if (pub.source === Track.Source.Microphone) entry.mic = pub.track;
        else if (pub.source === Track.Source.ScreenShare) entry.screen = pub.track;
        else if (pub.source === Track.Source.ScreenShareAudio) entry.screenAudio = pub.track;
      }
      next[identity] = entry;
    }
    setPeers(next);
  }, []);

  // --- connect --------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const lk = createRoom();
    lkRef.current = lk;

    // Identity is the socket id, so LiveKit participants line up 1:1 with
    // roster entries without any extra mapping.
    const onLiveKitCreds = async ({ url, token }) => {
      if (cancelled || hasJoinedRef.current) return;
      hasJoinedRef.current = true;
      clearTimeout(credsTimerRef.current);

      try {
        await lk.connect(url, token);
      } catch (err) {
        console.error("LiveKit connect failed:", err);
        setStatus("error");
        return;
      }
      if (cancelled) return;

      await publishLocalMedia();
      setStatus("connected");
    };

    async function publishLocalMedia() {
      const cfg = cfgRef.current;

      await lk.localParticipant.setMicrophoneEnabled(cfg.audio ?? true, {
        deviceId: cfg.audioDeviceId,
      });

      // The raw camera, published directly. Virtual backgrounds are attached
      // later as a LiveKit TrackProcessor only if the user picks one — see
      // setBackground. Nobody pays for MediaPipe just by joining.
      const pub = await lk.localParticipant.setCameraEnabled(true, {
        deviceId: cfg.videoDeviceId,
      });
      publishedCamRef.current = pub?.track || null;
      setLocalCamera(pub?.track || null);
      setBgReady(true);

      if (!(cfg.video ?? true)) await pub?.track?.mute();
    }

    // --- LiveKit events ---
    lk.on(RoomEvent.TrackSubscribed, syncPeers)
      .on(RoomEvent.TrackUnsubscribed, syncPeers)
      .on(RoomEvent.ParticipantConnected, syncPeers)
      .on(RoomEvent.ParticipantDisconnected, syncPeers)
      .on(RoomEvent.TrackMuted, syncPeers)
      .on(RoomEvent.TrackUnmuted, syncPeers)
      // Dominant-speaker detection, done by the SFU instead of by running a Web
      // Audio analyser on every incoming stream. At 20 people the old approach
      // would mean 20 analysers in the main thread.
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const map = {};
        for (const s of speakers) map[s.identity] = true;
        setSpeaking(map);
      })
      // The SFU already measures each participant's link, so the old getStats
      // polling loop (which sampled every peer connection every 3 seconds) is
      // replaced by an event.
      .on(RoomEvent.ConnectionQualityChanged, (lkQuality, participant) => {
        const map = { excellent: "good", good: "ok", poor: "poor", lost: "poor" };
        setQuality((prev) => ({ ...prev, [participant.identity]: map[lkQuality] || "ok" }));
      })
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Reconnecting) setStatus("reconnecting");
        else if (state === ConnectionState.Connected) setStatus("connected");
      })
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) setStatus("connecting");
      });

    // --- our own signalling: roster, chat, host, waiting room ---
    const onJoined = ({ selfId: id, chat, maxPeers: cap }) => {
      setSelfId(id);
      setMessages(chat || []);
      setMaxPeers(cap ?? null);

      // Being admitted should be followed immediately by a media credential.
      // If it is not, the server has no LiveKit configured — and the failure is
      // otherwise completely silent: you sit in a room with a black tile and a
      // timer that never starts, with nothing on screen saying why.
      credsTimerRef.current = setTimeout(() => {
        if (!hasJoinedRef.current && !cancelled) setStatus("no-media-server");
      }, 6000);
    };

    const onReaction = (r) => {
      const key = `${r.id}-${r.ts}-${Math.random()}`;
      setReactions((prev) => [...prev, { ...r, key }]);
      setTimeout(() => setReactions((prev) => prev.filter((x) => x.key !== key)), 4000);
    };

    const onForceMute = async ({ by }) => {
      await lk.localParticipant.setMicrophoneEnabled(false);
      setAudioOn(false);
      emitState({ audio: false });
      flash(`${by || "The host"} muted you`);
    };

    const joinPayload = {
      roomId,
      name,
      media: { audio: cfgRef.current.audio ?? true, video: cfgRef.current.video ?? true },
    };

    const handlers = {
      livekit: onLiveKitCreds,
      joined: onJoined,
      // The host approved us. Admission is a handshake rather than the server
      // pushing us straight in, because in a cluster our socket may be held by
      // a different instance than the host's — only ours can set our session
      // up. So we ask again, and this time we are on the approved list.
      admitted: () => socket.emit("join", joinPayload),
      "room-state": setRoom,
      chat: (msg) => setMessages((prev) => [...prev, msg]),
      reaction: onReaction,
      "force-mute": onForceMute,
      "room-full": () => setStatus("full"),
      waiting: () => setStatus("waiting"),
      denied: () => setStatus("denied"),
      removed: () => setStatus("removed"),
      "meeting-ended": () => setStatus("ended"),
    };
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);

    connectSocket();
    socket.emit("join", joinPayload);

    return () => {
      cancelled = true;
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      clearTimeout(credsTimerRef.current);
      socket.emit("leave");
      processorRef.current?.destroy?.();
      lk.disconnect();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name]);

  // Drop the publish ceiling as the room fills, and raise it again as it
  // empties. setPublishingQuality caps the top simulcast layer in place — no
  // republish, no renegotiation, so nobody sees a gap.
  const participantCount = room.participants.length;
  useEffect(() => {
    const track = publishedCamRef.current;
    if (!track || !participantCount) return;
    try {
      track.setPublishingQuality(publishQualityFor(participantCount));
    } catch (err) {
      console.warn("setPublishingQuality:", err);
    }
  }, [participantCount, localCamera]);

  // --- controls -------------------------------------------------------------

  const toggleAudio = useCallback(async () => {
    const lk = lkRef.current;
    const next = !audioOn;
    await lk?.localParticipant.setMicrophoneEnabled(next);
    setAudioOn(next);
    emitState({ audio: next });
  }, [audioOn, emitState]);

  const toggleVideo = useCallback(async () => {
    const next = !videoOn;
    // Mute the publication rather than unpublishing: republishing would cost a
    // renegotiation and a visible gap for every subscriber.
    const track = publishedCamRef.current;
    if (next) await track?.unmute();
    else await track?.mute();
    processorRef.current?.setEnabled(next);
    setVideoOn(next);
    emitState({ video: next });
  }, [videoOn, emitState]);

  const toggleHand = useCallback(() => {
    setHandRaised((prev) => {
      const next = !prev;
      emitState({ hand: next });
      return next;
    });
  }, [emitState]);

  const toggleShare = useCallback(async () => {
    const lk = lkRef.current;
    if (!lk) return;

    if (sharing) {
      await lk.localParticipant.setScreenShareEnabled(false);
      setLocalScreen(null);
      setSharing(false);
      emitState({ sharing: false });
      return;
    }

    if (!canShareScreen) {
      flash(screenShareUnavailableReason());
      return;
    }

    try {
      // LiveKit runs getDisplayMedia itself and publishes the result as a
      // ScreenShare-source track — a separate publication from the camera, so
      // presenting never costs you your face. audio:true picks up system/tab
      // audio as its own ScreenShareAudio track where the browser allows it.
      const pub = await lk.localParticipant.setScreenShareEnabled(true, { audio: true });
      if (!pub) return; // user dismissed the picker

      setLocalScreen(pub.track);
      setSharing(true);
      emitState({ sharing: true });

      // Fires when the user stops from the browser's own sharing bar.
      pub.track?.once("ended", () => {
        setLocalScreen(null);
        setSharing(false);
        emitState({ sharing: false });
      });
    } catch (err) {
      if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
        console.warn("Screen share failed:", err);
        flash("Couldn't start screen sharing.");
      }
    }
  }, [sharing, emitState, flash]);

  const switchCamera = useCallback(async (deviceId) => {
    // restartTrack swaps the capture device on the existing publication, so no
    // renegotiation. Any attached processor is restarted onto the new source by
    // LiveKit itself.
    await publishedCamRef.current?.restartTrack({ deviceId: { exact: deviceId } });
  }, []);

  const switchMic = useCallback(async (deviceId) => {
    await lkRef.current?.switchActiveDevice("audioinput", deviceId);
  }, []);

  /**
   * Attach, update, or remove the background effect.
   *
   * "none" detaches the processor entirely rather than running it in
   * passthrough — a passthrough canvas still costs a full-rate frame copy and a
   * redraw loop, which is exactly what we are avoiding.
   */
  const setBackground = useCallback(async (effect, image = null) => {
    const track = publishedCamRef.current;
    if (!track) return;

    try {
      if (effect === "none") {
        if (processorRef.current) {
          await track.stopProcessor();
          processorRef.current = null;
        }
        return;
      }

      if (processorRef.current) {
        processorRef.current.setEffect(effect, image);
        return;
      }

      // Dynamic import: MediaPipe stays out of the initial bundle and is only
      // fetched the first time someone actually picks a background.
      const { BackgroundTrackProcessor } = await import(
        "../model/backgroundTrackProcessor.js"
      );
      const processor = new BackgroundTrackProcessor(effect, image);
      await track.setProcessor(processor);
      processorRef.current = processor;
    } catch (err) {
      console.warn("Background effect failed:", err);
      flash("Couldn't apply that background.");
    }
  }, [flash]);

  const sendChat = useCallback((text) => socket.emit("chat", { text }), []);
  const sendReaction = useCallback((emoji) => socket.emit("reaction", { emoji }), []);

  const self = room.participants.find((p) => p.id === selfId);
  const isHost = !!selfId && room.hostId === selfId;
  const isCoHost = !!self?.isCoHost;
  const isModerator = isHost || isCoHost;

  return {
    selfId,
    localCamera,
    localScreen,
    peers,
    room,
    isHost,
    messages,
    reactions,
    speaking,
    quality,
    maxPeers,
    status,
    notice,
    bgReady,
    isCoHost,
    isModerator,
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
    host: {
      mute: (id) => socket.emit("host:mute", { id }),
      remove: (id) => socket.emit("host:remove", { id }),
      setLocked: (locked) => socket.emit("host:lock", { locked }),
      admit: (id) => socket.emit("host:admit", { id }),
      deny: (id) => socket.emit("host:deny", { id }),
      promote: (id) => socket.emit("host:promote", { id }),
      demote: (id) => socket.emit("host:demote", { id }),
      end: () => socket.emit("host:end"),
    },
  };
}
