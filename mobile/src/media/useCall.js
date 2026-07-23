import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioSession, registerGlobals } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track, VideoPresets, VideoQuality } from 'livekit-client';
import { connectSocket, socket, SIGNALING_URL } from './signaling';

// Must run before any LiveKit object is constructed — it installs the WebRTC
// globals (RTCPeerConnection, MediaStream, …) that livekit-client expects to
// find the way a browser provides them.
registerGlobals();

/**
 * Publish ceilings, matched to the web client so a phone and a laptop in the
 * same room behave consistently. See client/src/model/livekitRoom.js for the
 * reasoning; the short version is that a large room does not need 720p faces,
 * and on a phone the encode is what drains the battery.
 */
function publishQualityFor(participantCount) {
  return participantCount <= 6 ? VideoQuality.HIGH : VideoQuality.MEDIUM;
}

/**
 * useCall — the mobile media layer, on the same SFU as the web client.
 *
 * Deliberately the same shape as the web's useLiveKit: LiveKit carries media,
 * our own socket carries the rules (roster, host controls, waiting room, chat).
 * A phone and a browser join the same room, on the same server, with the same
 * token — that is what the SFU bought us, and it is why the mesh had to go.
 *
 * What differs from web, and only what genuinely differs on a phone:
 *   - virtual backgrounds are a NATIVE frame processor, not a canvas
 *     (React Native has no canvas) — see SolidBackgroundProcessor.kt
 *   - camera switching is a front/back flip, not a device picker
 *   - screen capture is MediaProjection (Android) rather than a picker dialog,
 *     and needs the foreground service declared in AndroidManifest.xml
 *   - AudioSession must be started/stopped explicitly, or the OS routes call
 *     audio to the media stream and the earpiece behaves oddly
 */
export function useCall({ roomId, name }) {
  const [selfId, setSelfId] = useState(null);
  const [localCamera, setLocalCamera] = useState(null);
  const [localScreen, setLocalScreen] = useState(null);
  const [peers, setPeers] = useState({}); // id -> { camera, mic, screen, screenAudio }
  const [room, setRoom] = useState({ hostId: null, locked: false, participants: [], waiting: [] });
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]); // transient floating emoji
  const [speaking, setSpeaking] = useState({});
  const [maxPeers, setMaxPeers] = useState(null);
  const [status, setStatus] = useState('connecting');
  const [notice, setNotice] = useState(null);

  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [sharing, setSharing] = useState(false);
  // Which way the camera points. Only a front-facing preview should be
  // mirrored — mirroring the rear camera renders the world back-to-front and
  // makes any text in shot unreadable.
  const [facing, setFacing] = useState('user');
  const [background, setBackgroundState] = useState('none'); // none | black | white

  const lkRef = useRef(null);
  const publishedCamRef = useRef(null);
  const hasJoinedRef = useRef(false);
  const credsTimerRef = useRef(null);

  const emitState = useCallback(patch => socket.emit('state', patch), []);

  const flash = useCallback(text => {
    setNotice(text);
    setTimeout(() => setNotice(n => (n === text ? null : n)), 3500);
  }, []);

  // The UI is handed TrackReferences ({ participant, publication, source }),
  // not bare Tracks. That is what <VideoTrack> takes, and it is what lets
  // adaptive stream work: the component measures its rendered size and tells
  // the server which simulcast layer to send, pausing the track entirely when
  // the tile scrolls out of view. Passing a raw Track renders nothing.
  const trackRef = (participant, publication) => ({
    participant,
    publication,
    source: publication.source,
  });

  const syncPeers = useCallback(() => {
    const lk = lkRef.current;
    if (!lk) return;

    const next = {};
    for (const [identity, p] of lk.remoteParticipants) {
      const entry = { camera: null, mic: null, screen: null, screenAudio: null };
      for (const pub of p.trackPublications.values()) {
        if (!pub.track) continue;
        if (pub.source === Track.Source.Camera) entry.camera = trackRef(p, pub);
        else if (pub.source === Track.Source.Microphone) entry.mic = trackRef(p, pub);
        else if (pub.source === Track.Source.ScreenShare) entry.screen = trackRef(p, pub);
        else if (pub.source === Track.Source.ScreenShareAudio) {
          entry.screenAudio = trackRef(p, pub);
        }
      }
      next[identity] = entry;
    }
    setPeers(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const lk = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: {
        simulcast: true,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
        videoEncoding: VideoPresets.h720.encoding,
        screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30, priority: 'high' },
        screenShareSimulcastLayers: [],
        red: true,
        dtx: true,
      },
      videoCaptureDefaults: { resolution: VideoPresets.h720.resolution },
    });
    lkRef.current = lk;

    const onLiveKitCreds = async ({ url, token }) => {
      if (cancelled || hasJoinedRef.current) return;
      hasJoinedRef.current = true;
      clearTimeout(credsTimerRef.current);
      console.log('[call] livekit credentials received, connecting to', url);

      try {
        // Route audio as a call rather than as media playback.
        await AudioSession.startAudioSession();
        await lk.connect(url, token);
        if (cancelled) return;

        await lk.localParticipant.setMicrophoneEnabled(true);
        const pub = await lk.localParticipant.setCameraEnabled(true);
        // The Track is kept for control (mute, quality); the TrackReference is
        // what the view renders.
        publishedCamRef.current = pub?.track || null;
        setLocalCamera(pub ? trackRef(lk.localParticipant, pub) : null);

        setStatus('connected');
      } catch (err) {
        console.error('LiveKit connect failed:', err);
        if (!cancelled) setStatus('error');
      }
    };

    lk.on(RoomEvent.TrackSubscribed, syncPeers)
      .on(RoomEvent.TrackUnsubscribed, syncPeers)
      .on(RoomEvent.ParticipantConnected, syncPeers)
      .on(RoomEvent.ParticipantDisconnected, syncPeers)
      .on(RoomEvent.TrackMuted, syncPeers)
      .on(RoomEvent.TrackUnmuted, syncPeers)
      .on(RoomEvent.ActiveSpeakersChanged, speakers => {
        const map = {};
        for (const s of speakers) map[s.identity] = true;
        setSpeaking(map);
      })
      .on(RoomEvent.ConnectionStateChanged, state => {
        if (state === ConnectionState.Reconnecting) setStatus('reconnecting');
        else if (state === ConnectionState.Connected) setStatus('connected');
      });

    const joinPayload = { roomId, name, media: { audio: true, video: true } };

    const handlers = {
      livekit: onLiveKitCreds,
      joined: ({ selfId: id, chat, maxPeers: cap }) => {
        console.log('[call] joined room as', id, 'cap', cap);
        setSelfId(id);
        setMessages(chat || []);
        setMaxPeers(cap ?? null);

        // Admission should be followed immediately by a media credential. If it
        // is not, the server has no LiveKit configured — otherwise this fails
        // completely silently: a black screen and a timer that never starts.
        credsTimerRef.current = setTimeout(() => {
          if (!hasJoinedRef.current && !cancelled) setStatus('no-media-server');
        }, 6000);
      },
      // The host approved us. Our socket may be held by a different server
      // instance than theirs, so admission is a handshake: we ask again.
      admitted: () => socket.emit('join', joinPayload),
      'room-state': (state) => {
        console.log('[call] roster:', state?.participants?.length, 'participant(s)');
        setRoom(state);
      },
      chat: msg => setMessages(prev => [...prev, msg]),
      reaction: r => {
        const key = `${r.id}-${r.ts}-${Math.random()}`;
        setReactions(prev => [...prev, { ...r, key }]);
        setTimeout(() => setReactions(prev => prev.filter(x => x.key !== key)), 4000);
      },
      'force-mute': async ({ by }) => {
        await lk.localParticipant.setMicrophoneEnabled(false);
        setAudioOn(false);
        emitState({ audio: false });
        flash(`${by || 'The host'} muted you`);
      },
      'room-full': () => setStatus('full'),
      waiting: () => setStatus('waiting'),
      denied: () => setStatus('denied'),
      removed: () => setStatus('removed'),
      'meeting-ended': () => setStatus('ended'),
    };
    for (const [event, handler] of Object.entries(handlers)) socket.on(event, handler);

    const onConnect = () => {
      console.log('[call] socket connected', socket.id, '->', SIGNALING_URL);
      socket.emit('join', joinPayload);
    };
    const onConnectError = (err) => {
      console.warn('[call] socket connect_error:', err?.message || err);
      if (!cancelled) setStatus('offline');
    };
    const onDisconnect = (reason) => console.warn('[call] socket disconnected:', reason);

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);

    // Join on connect rather than immediately: emitting before the socket is
    // up queues the event, and if the connection never establishes we sit
    // silently forever instead of reporting it.
    connectSocket();

    return () => {
      cancelled = true;
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      clearTimeout(credsTimerRef.current);
      socket.emit('leave');
      lk.disconnect();
      AudioSession.stopAudioSession();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name]);

  // Drop the publish ceiling as the room fills. Caps the top simulcast layer in
  // place — no republish, so nobody sees a gap.
  const participantCount = room.participants.length;
  useEffect(() => {
    const track = publishedCamRef.current;
    if (!track || !participantCount) return;
    try {
      track.setPublishingQuality(publishQualityFor(participantCount));
    } catch (err) {
      console.warn('setPublishingQuality:', err);
    }
  }, [participantCount, localCamera]);

  // --- controls -------------------------------------------------------------

  const toggleAudio = useCallback(async () => {
    const next = !audioOn;
    await lkRef.current?.localParticipant.setMicrophoneEnabled(next);
    setAudioOn(next);
    emitState({ audio: next });
  }, [audioOn, emitState]);

  /**
   * Stopping video RELEASES the camera rather than muting the track.
   *
   * mute() only stops transmission: the hardware stays open, the OS camera
   * indicator stays lit, and the local renderer keeps displaying the last
   * frame it received — which is the "frozen picture" you get instead of a
   * camera that actually turned off. setCameraEnabled(false) unpublishes and
   * closes the device.
   *
   * The cost is a republish when it comes back on, which LiveKit handles; that
   * is the right trade for a camera light that behaves the way users expect.
   */
  const toggleVideo = useCallback(async () => {
    const lk = lkRef.current;
    if (!lk) return;
    const next = !videoOn;

    // Flip state first so the UI swaps to the placeholder immediately rather
    // than holding the stale frame while the camera shuts down.
    setVideoOn(next);
    emitState({ video: next });

    if (next) {
      const pub = await lk.localParticipant.setCameraEnabled(true, { facingMode: facing });
      publishedCamRef.current = pub?.track || null;
      setLocalCamera(pub ? trackRef(lk.localParticipant, pub) : null);

      // A republished track is a NEW native track, so any effect on the old
      // one is gone. Re-apply it or the background silently disappears the
      // first time someone toggles their camera.
      if (background !== 'none') {
        const mst = pub?.track?.mediaStreamTrack;
        try {
          mst?._setVideoEffects([background === 'black' ? 'bg-black' : 'bg-white']);
        } catch (err) {
          console.warn('re-apply background failed:', err);
        }
      }
    } else {
      await lk.localParticipant.setCameraEnabled(false);
      publishedCamRef.current = null;
      setLocalCamera(null);
    }
  }, [videoOn, facing, background, emitState]);

  const toggleHand = useCallback(() => {
    setHandRaised(prev => {
      const next = !prev;
      emitState({ hand: next });
      return next;
    });
  }, [emitState]);

  const flipCamera = useCallback(async () => {
    const track = publishedCamRef.current;
    if (!track) return;
    const next = facing === 'user' ? 'environment' : 'user';
    await track.restartTrack({ facingMode: next });
    setFacing(next);
  }, [facing]);

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

    try {
      // Android: raises the system MediaProjection consent dialog and runs
      // capture inside the foreground service declared in AndroidManifest.xml.
      // The grant cannot be persisted — every session asks again, by design.
      // iOS: requires the Broadcast Upload Extension (not built yet).
      const pub = await lk.localParticipant.setScreenShareEnabled(true);
      if (!pub) return; // user declined the consent dialog

      setLocalScreen(trackRef(lk.localParticipant, pub));
      setSharing(true);
      emitState({ sharing: true });

      pub.track?.once('ended', () => {
        setLocalScreen(null);
        setSharing(false);
        emitState({ sharing: false });
      });
    } catch (err) {
      console.warn('Screen share failed:', err);
      flash(
        Platform.OS === 'ios'
          ? 'Screen sharing needs the broadcast extension (not built yet).'
          : "Couldn't start screen sharing.",
      );
    }
  }, [sharing, emitState, flash]);

  /**
   * Virtual background, applied natively.
   *
   * The web client pipes the camera through a canvas; React Native has no
   * canvas, so this instead names a frame processor registered on the native
   * side (see SolidBackgroundProcessor.kt) and lets WebRTC apply it in the
   * capture pipeline, before encoding. Passing an empty list clears it.
   */
  const setBackground = useCallback(effect => {
    const mst = publishedCamRef.current?.mediaStreamTrack;
    if (!mst?._setVideoEffects) return;
    try {
      if (effect === 'black') mst._setVideoEffects(['bg-black']);
      else if (effect === 'white') mst._setVideoEffects(['bg-white']);
      else mst._setVideoEffects([]);
      setBackgroundState(effect);
    } catch (err) {
      console.warn('setBackground failed:', err);
    }
  }, []);

  const sendChat = useCallback(text => socket.emit('chat', { text }), []);
  const sendReaction = useCallback(emoji => socket.emit('reaction', { emoji }), []);

  return {
    selfId,
    localCamera,
    localScreen,
    peers,
    room,
    maxPeers,
    messages,
    speaking,
    status,
    notice,
    audioOn,
    videoOn,
    handRaised,
    sharing,
    facing,
    toggleAudio,
    toggleVideo,
    toggleHand,
    toggleShare,
    flipCamera,
    setBackground,
    background,
    sendChat,
    sendReaction,
    reactions,
    isHost: !!selfId && room.hostId === selfId,
    isModerator:
      !!selfId &&
      (room.hostId === selfId ||
        !!room.participants.find((p) => p.id === selfId)?.isCoHost),
    host: {
      mute: (id) => socket.emit('host:mute', { id }),
      remove: (id) => socket.emit('host:remove', { id }),
      setLocked: (locked) => socket.emit('host:lock', { locked }),
      admit: (id) => socket.emit('host:admit', { id }),
      deny: (id) => socket.emit('host:deny', { id }),
      promote: (id) => socket.emit('host:promote', { id }),
      demote: (id) => socket.emit('host:demote', { id }),
      end: () => socket.emit('host:end'),
    },
  };
}
