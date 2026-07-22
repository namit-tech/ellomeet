import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCall } from '../media/useCall';

// Filmstrip page size. Matches the web client's STRIP_PAGE_SIZE.
const STRIP_PAGE_SIZE = 6;
import { requestCallPermissions } from '../permissions';
import VideoTile from './VideoTile';

/**
 * CallScreen — the phone equivalent of the web client's Room.
 *
 * Same spotlight rule as the web: whatever is selected fills the stage, and a
 * live presentation claims it by default because an unreadable screen in a
 * thumbnail is useless. Tapping any tile in the strip promotes it.
 */
export default function CallScreen({ roomId, name, onLeave }) {
  const [ready, setReady] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    requestCallPermissions().then(ok => (ok ? setReady(true) : setDenied(true)));
  }, []);

  if (denied) {
    return (
      <Message
        title="Camera and microphone are required"
        body="Grant access in Settings, then reopen the app."
        action={{ label: 'Back', onPress: onLeave }}
      />
    );
  }

  if (!ready) return <Message title="Requesting permissions…" spinner />;

  return <Call roomId={roomId} name={name} onLeave={onLeave} />;
}

function Call({ roomId, name, onLeave }) {
  // React Native's own SafeAreaView is a no-op on Android (and RN now warns
  // that it is deprecated). Android 15+ enforces edge-to-edge, so without
  // real insets the header renders underneath the status bar and the controls
  // sit under the gesture pill — which is exactly what the device showed.
  const insets = useSafeAreaInsets();

  const {
    selfId,
    localCamera,
    localScreen,
    peers,
    room,
    maxPeers,
    speaking,
    status,
    notice,
    audioOn,
    videoOn,
    sharing,
    handRaised,
    toggleAudio,
    toggleVideo,
    toggleShare,
    toggleHand,
    flipCamera,
  } = useCall({ roomId, name });

  const [selectedKey, setSelectedKey] = useState(null);
  const [page, setPage] = useState(0);

  // Camera tile per participant, plus a screen tile per live presentation —
  // the same two-tiles-per-presenter model the web client uses.
  const tiles = useMemo(() => {
    const out = [];
    const cameraFor = p => (p.id === selfId ? localCamera : peers[p.id]?.camera || null);
    const screenFor = p => (p.id === selfId ? localScreen : peers[p.id]?.screen || null);

    for (const p of room.participants) {
      out.push({ key: p.id, participant: p, track: cameraFor(p), isScreen: false });
    }
    for (const p of room.participants) {
      if (!p.sharing) continue;
      const scr = screenFor(p);
      if (scr) out.push({ key: `${p.id}:screen`, participant: p, track: scr, isScreen: true });
    }
    return out;
  }, [room.participants, peers, localCamera, localScreen, selfId]);

  const firstScreen = tiles.find(t => t.isScreen);
  const focusKey =
    (tiles.some(t => t.key === selectedKey) && selectedKey) || firstScreen?.key || tiles[0]?.key;
  const focus = tiles.find(t => t.key === focusKey);
  const others = tiles.filter(t => t.key !== focusKey);
  // Whoever is talking is promoted onto the visible page, so the person you
  // want to see is never stranded off-screen.
  const ordered = [...others].sort((a, b) => {
    const sa = !a.isScreen && speaking[a.participant.id] ? 1 : 0;
    const sb = !b.isScreen && speaking[b.participant.id] ? 1 : 0;
    return sb - sa;
  });
  const pageCount = Math.max(1, Math.ceil(ordered.length / STRIP_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  // THIS is the bandwidth saving: a tile that is not rendered is not attached,
  // so LiveKit pauses the track at the server and it costs nothing.
  const strip = ordered.slice(safePage * STRIP_PAGE_SIZE, (safePage + 1) * STRIP_PAGE_SIZE);

  if (status === 'full') {
    return <Message title="Room is full" body="This meeting already has 4 people." action={{ label: 'Back', onPress: onLeave }} />;
  }
  if (status === 'error') {
    return <Message title="Couldn't start camera" body="Check permissions and try again." action={{ label: 'Back', onPress: onLeave }} />;
  }
  if (status === 'ended') {
    return <Message title="Meeting ended" body="The host ended this meeting." action={{ label: 'Back', onPress: onLeave }} />;
  }
  if (status === 'no-media-server') {
    return (
      <Message
        title="Media server not configured"
        body="Connected to the signalling server, but it issued no LiveKit credentials, so no audio or video can flow. Set LIVEKIT_URL / _API_KEY / _API_SECRET on the server."
        action={{ label: 'Back', onPress: onLeave }}
      />
    );
  }
  if (status === 'offline') {
    return (
      <Message
        title="Can't reach the server"
        body={'Could not connect to the signalling server. Check the device has network and that SIGNALING_URL is reachable from the phone.'}
        action={{ label: 'Back', onPress: onLeave }}
      />
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <Text style={styles.headerText}>
          Room {roomId} · {room.participants.length}
          {maxPeers ? `/${maxPeers}` : ''}
        </Text>
        {status === 'connecting' && <ActivityIndicator size="small" color="#4c8dff" />}
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.stage}>
        {focus && (
          <VideoTile
            {...focus}
            isLocal={focus.participant.id === selfId}
            selected
            onPress={() => setSelectedKey(focus.key)}
          />
        )}
      </View>

      {pageCount > 1 && (
        <View style={styles.pager}>
          <TouchableOpacity
            style={[styles.pagerBtn, safePage === 0 && styles.pagerBtnOff]}
            disabled={safePage === 0}
            onPress={() => setPage(p => Math.max(0, p - 1))}
          >
            <Text style={styles.pagerText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.pagerLabel}>
            {safePage + 1} / {pageCount}
          </Text>
          <TouchableOpacity
            style={[styles.pagerBtn, safePage === pageCount - 1 && styles.pagerBtnOff]}
            disabled={safePage === pageCount - 1}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
          >
            <Text style={styles.pagerText}>›</Text>
          </TouchableOpacity>
        </View>
      )}

      {strip.length > 0 && (
        <ScrollView horizontal style={styles.strip} contentContainerStyle={styles.stripInner}>
          {strip.map(t => (
            <View key={t.key} style={styles.stripItem}>
              <VideoTile
                {...t}
                isLocal={t.participant.id === selfId}
                speaking={!t.isScreen && !!speaking[t.participant.id]}
                selected={false}
                onPress={() => setSelectedKey(t.key)}
              />
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.controls}>
        <Ctrl label={audioOn ? 'Mute' : 'Unmute'} icon={audioOn ? '🎙️' : '🔇'} onPress={toggleAudio} off={!audioOn} />
        <Ctrl label={videoOn ? 'Stop' : 'Start'} icon={videoOn ? '📹' : '🚫'} onPress={toggleVideo} off={!videoOn} />
        <Ctrl label={sharing ? 'Stop share' : 'Share'} icon="🖥️" onPress={toggleShare} active={sharing} />
        <Ctrl label="Flip" icon="🔄" onPress={flipCamera} />
        <Ctrl label="Hand" icon="✋" onPress={toggleHand} active={handRaised} />
        <Ctrl label="Leave" icon="📞" onPress={onLeave} danger />
      </View>
    </View>
  );
}

function Ctrl({ label, icon, onPress, off, active, danger }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.ctrl, off && styles.ctrlOff, active && styles.ctrlActive, danger && styles.ctrlDanger]}
    >
      <Text style={styles.ctrlIcon}>{icon}</Text>
      <Text style={styles.ctrlLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function Message({ title, body, action, spinner }) {
  return (
    <View style={[styles.root, styles.centered]}>
      {spinner && <ActivityIndicator size="large" color="#4c8dff" />}
      <Text style={styles.msgTitle}>{title}</Text>
      {body ? <Text style={styles.msgBody}>{body}</Text> : null}
      {action && (
        <TouchableOpacity onPress={action.onPress} style={styles.msgBtn}>
          <Text style={styles.msgBtnText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0f13' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerText: { color: '#c9ced8', fontSize: 13 },
  notice: { backgroundColor: '#4c8dff', marginHorizontal: 12, padding: 8, borderRadius: 8 },
  noticeText: { color: '#fff', fontSize: 12, textAlign: 'center' },
  stage: { flex: 1, padding: 4 },
  strip: { maxHeight: 120, flexGrow: 0 },
  stripInner: { paddingHorizontal: 4 },
  stripItem: { width: 160, height: 110 },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 4 },
  pagerBtn: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#22252c' },
  pagerBtnOff: { opacity: 0.4 },
  pagerText: { color: '#fff', fontSize: 16 },
  pagerLabel: { color: '#9aa2b1', fontSize: 12 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderTopWidth: 1,
    borderTopColor: '#22252c',
  },
  ctrl: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
  ctrlOff: { backgroundColor: '#3a1f24' },
  ctrlActive: { backgroundColor: '#1d3357' },
  ctrlDanger: { backgroundColor: '#7a2530' },
  ctrlIcon: { fontSize: 20 },
  ctrlLabel: { color: '#9aa2b1', fontSize: 10, marginTop: 3 },
  msgTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  msgBody: { color: '#9aa2b1', fontSize: 14, marginTop: 8, textAlign: 'center' },
  msgBtn: { marginTop: 18, backgroundColor: '#4c8dff', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  msgBtnText: { color: '#fff', fontWeight: '600' },
});
