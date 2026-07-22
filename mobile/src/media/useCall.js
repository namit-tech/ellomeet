import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AudioSession, registerGlobals } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent, Track, VideoPresets, VideoQuality } from 'livekit-client';
import { connectSocket, socket } from './signaling';

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
 *   - no virtual backgrounds: React Native has no <canvas> for the processor
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
  const [speaking, setSpeaking] = useState({});
  const [status, setStatus] = useState('connecting');
  const [notice, setNotice] = useState(null);

  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [sharing, setSharing] = useState(false);

  const lkRef = useRef(null);
  const publishedCamRef = useRef(null);
  const hasJoinedRef = useRef(false);

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
      joined: ({ selfId: id, chat }) => {
        setSelfId(id);
        setMessages(chat || []);
      },
      // The host approved us. Our socket may be held by a different server
      // instance than theirs, so admission is a handshake: we ask again.
      admitted: () => socket.emit('join', joinPayload),
      'room-state': setRoom,
      chat: msg => setMessages(prev => [...prev, msg]),
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

    connectSocket();
    socket.emit('join', joinPayload);

    return () => {
      cancelled = true;
      for (const [event, handler] of Object.entries(handlers)) socket.off(event, handler);
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

  const toggleVideo = useCallback(async () => {
    const next = !videoOn;
    const track = publishedCamRef.current;
    if (next) await track?.unmute();
    else await track?.mute();
    setVideoOn(next);
    emitState({ video: next });
  }, [videoOn, emitState]);

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
    const facing = track.mediaStreamTrack?.getSettings?.().facingMode;
    await track.restartTrack({ facingMode: facing === 'environment' ? 'user' : 'environment' });
  }, []);

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

  const sendChat = useCallback(text => socket.emit('chat', { text }), []);
  const sendReaction = useCallback(emoji => socket.emit('reaction', { emoji }), []);

  return {
    selfId,
    localCamera,
    localScreen,
    peers,
    room,
    messages,
    speaking,
    status,
    notice,
    audioOn,
    videoOn,
    handRaised,
    sharing,
    toggleAudio,
    toggleVideo,
    toggleHand,
    toggleShare,
    flipCamera,
    sendChat,
    sendReaction,
    isHost: !!selfId && room.hostId === selfId,
  };
}
