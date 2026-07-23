import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Hand,
  Check,
  Link as LinkIcon,
  Lock,
  MessageSquare,
  Mic,
  MicOff,
  Minimize2,
  PictureInPicture,
  MonitorUp,
  MonitorX,
  PhoneOff,
  RefreshCw,
  Send,
  Shield,
  Smile,
  Sparkles,
  Unlock,
  Users,
  Video as VideoIcon,
  VideoOff,
  X,
} from 'lucide-react-native';
import { useCall } from '../media/useCall';
import { usePictureInPicture, enterPip } from '../media/pip';
import { requestCallPermissions } from '../permissions';
import VideoTile from './VideoTile';

// Where a room lives on the web, for invite links.
const WEB_ORIGIN = 'https://meet.elloindia.in';

// Filmstrip page size. An unrendered tile is an unsubscribed one, so this is a
// bandwidth decision as much as a layout one.
const STRIP_PAGE_SIZE = 6;

const REACTIONS = ['👍', '👏', '❤️', '😂', '🎉', '😮', '👋'];

/**
 * CallScreen — the phone equivalent of the web client's Room.
 *
 * Same feature set and the same icon family (lucide) as the web, so the two
 * clients read as one product rather than two.
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
  // React Native's own SafeAreaView is a no-op on Android. Android 15+ enforces
  // edge-to-edge, so without real insets the header renders under the status
  // bar and the controls sit under the gesture pill.
  const insets = useSafeAreaInsets();

  const {
    selfId,
    localCamera,
    localScreen,
    peers,
    room,
    maxPeers,
    messages,
    reactions,
    speaking,
    status,
    notice,
    audioOn,
    videoOn,
    handRaised,
    sharing,
    facing,
    isHost,
    isModerator,
    toggleAudio,
    toggleVideo,
    toggleHand,
    toggleShare,
    flipCamera,
    sendChat,
    sendReaction,
    setBackground,
    background,
    host,
  } = useCall({ roomId, name });

  // Keep the call alive in a floating window when the user leaves the app.
  // The hook drives the native side (enter PiP, keep the camera capturing); the
  // UI collapse is decided from the window size instead of a native event,
  // because a PiP window is unmistakably tiny and that signal never misfires.
  const inPip = usePictureInPicture(true);

  const [selectedKey, setSelectedKey] = useState(null);
  const [pinnedKey, setPinnedKey] = useState(null);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState(null); // null | chat | people | react
  const [immersive, setImmersive] = useState(false);
  const [draft, setDraft] = useState('');

  // Camera tile per participant, plus a screen tile per live presentation —
  // the same two-tiles-per-presenter model as the web client.
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

  const has = key => key && tiles.some(t => t.key === key);
  const firstScreen = tiles.find(t => t.isScreen);
  const focusKey =
    (has(pinnedKey) && pinnedKey) ||
    (has(selectedKey) && selectedKey) ||
    firstScreen?.key ||
    tiles[0]?.key;
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
  const strip = ordered.slice(safePage * STRIP_PAGE_SIZE, (safePage + 1) * STRIP_PAGE_SIZE);

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  // A pinned tile whose owner left shouldn't strand the stage.
  useEffect(() => {
    const gone = k => k && !room.participants.some(p => p.id === k.split(':')[0]);
    if (gone(pinnedKey)) setPinnedKey(null);
    if (gone(selectedKey)) setSelectedKey(null);
  }, [room.participants, pinnedKey, selectedKey]);

  async function invite() {
    const url = `${WEB_ORIGIN}/room/${encodeURIComponent(roomId)}`;
    try {
      // The system share sheet rather than just the clipboard: people want to
      // send this straight to WhatsApp or Messages, not paste it themselves.
      await Share.share({ message: `Join my meeting: ${url}`, url });
    } catch (err) {
      console.warn('share failed', err);
    }
  }

  // Only a front-facing preview is mirrored. Mirroring the rear camera shows
  // the world back-to-front and makes any text in shot unreadable.
  const mirrorFor = t => t.participant.id === selfId && !t.isScreen && facing === 'user';

  if (status === 'full') return <Message title="Room is full" body={`This meeting is at its limit of ${maxPeers || ''} participants.`} action={{ label: 'Back', onPress: onLeave }} />;
  if (status === 'error') return <Message title="Couldn't start camera" body="Check permissions and try again." action={{ label: 'Back', onPress: onLeave }} />;
  if (status === 'ended') return <Message title="Meeting ended" body="The host ended this meeting." action={{ label: 'Back', onPress: onLeave }} />;
  if (status === 'denied') return <Message title="Not admitted" body="The host didn't let you in." action={{ label: 'Back', onPress: onLeave }} />;
  if (status === 'removed') return <Message title="You were removed" body="The host removed you from this meeting." action={{ label: 'Back', onPress: onLeave }} />;
  if (status === 'waiting') return <Message title="Waiting to be let in" body="This meeting is locked. The host has been asked to admit you." spinner action={{ label: 'Cancel', onPress: onLeave }} />;
  if (status === 'no-media-server') return <Message title="Media server not configured" body="Connected to signalling, but no LiveKit credentials were issued." action={{ label: 'Back', onPress: onLeave }} />;
  if (status === 'offline') return <Message title="Can't reach the server" body="Check the device has network and that the server is up." action={{ label: 'Back', onPress: onLeave }} />;

  if (inPip) {
    return (
      <View style={styles.pipRoot}>
        {focus && (
          <VideoTile
            {...focus}
            isLocal={focus.participant.id === selfId}
            mirror={mirrorFor(focus)}
          />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <StatusBar barStyle="light-content" />

      {!immersive && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.badge}>
              <Users size={13} color="#eef1f6" />
              <Text style={styles.badgeText}>
                {room.participants.length}
                {maxPeers ? `/${maxPeers}` : ''}
              </Text>
            </View>
            <Text style={styles.headerText} numberOfLines={1}>
              {roomId}
            </Text>
            {status === 'connecting' && <ActivityIndicator size="small" color="#4f8cff" />}
          </View>

          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.pipBtn} onPress={enterPip}>
              <PictureInPicture size={18} color="#eef1f6" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.inviteBtn} onPress={invite}>
              <LinkIcon size={14} color="#fff" />
              <Text style={styles.inviteText}>Invite</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {notice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {reactions.length > 0 && (
        <View style={styles.reactionOverlay} pointerEvents="none">
          {reactions.slice(-4).map(r => (
            <Text key={r.key} style={styles.reactionFloat}>
              {r.emoji}
            </Text>
          ))}
        </View>
      )}

      <View style={styles.stage}>
        {focus && (
          <VideoTile
            {...focus}
            isLocal={focus.participant.id === selfId}
            mirror={mirrorFor(focus)}
            speaking={!focus.isScreen && !!speaking[focus.participant.id]}
            selected
            pinned={focus.key === pinnedKey}
            showActions
            onPress={() => setSelectedKey(focus.key)}
            onTogglePin={() => setPinnedKey(focus.key === pinnedKey ? null : focus.key)}
            onToggleFullscreen={() => setImmersive(v => !v)}
          />
        )}
      </View>

      {!immersive && pageCount > 1 && (
        <View style={styles.pager}>
          <TouchableOpacity
            style={[styles.pagerBtn, safePage === 0 && styles.dim]}
            disabled={safePage === 0}
            onPress={() => setPage(p => Math.max(0, p - 1))}
          >
            <ChevronLeft size={16} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.pagerLabel}>
            {safePage + 1} / {pageCount}
          </Text>
          <TouchableOpacity
            style={[styles.pagerBtn, safePage === pageCount - 1 && styles.dim]}
            disabled={safePage === pageCount - 1}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
          >
            <ChevronRight size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {!immersive && strip.length > 0 && (
        <FlatList
          horizontal
          data={strip}
          keyExtractor={t => t.key}
          style={styles.strip}
          contentContainerStyle={styles.stripInner}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: t }) => (
            <View style={styles.stripItem}>
              <VideoTile
                {...t}
                isLocal={t.participant.id === selfId}
                mirror={mirrorFor(t)}
                speaking={!t.isScreen && !!speaking[t.participant.id]}
                onPress={() => setSelectedKey(t.key)}
              />
            </View>
          )}
        />
      )}

      {immersive ? (
        <TouchableOpacity style={styles.exitImmersive} onPress={() => setImmersive(false)}>
          <Minimize2 size={18} color="#fff" />
        </TouchableOpacity>
      ) : (
        <View style={styles.controls}>
          <Ctrl label={audioOn ? 'Mute' : 'Unmute'} Icon={audioOn ? Mic : MicOff} off={!audioOn} onPress={toggleAudio} />
          <Ctrl label={videoOn ? 'Stop' : 'Start'} Icon={videoOn ? VideoIcon : VideoOff} off={!videoOn} onPress={toggleVideo} />
          <Ctrl label={sharing ? 'Stop' : 'Share'} Icon={sharing ? MonitorX : MonitorUp} active={sharing} onPress={toggleShare} />
          <Ctrl label="Flip" Icon={RefreshCw} onPress={flipCamera} />
          <Ctrl label="Raise" Icon={Hand} active={handRaised} onPress={toggleHand} />
          <Ctrl label="React" Icon={Smile} active={panel === 'react'} onPress={() => setPanel(p => (p === 'react' ? null : 'react'))} />
          <Ctrl label="Effects" Icon={Sparkles} active={background !== 'none'} onPress={() => setPanel(p => (p === 'bg' ? null : 'bg'))} />
          <Ctrl label="People" Icon={Users} badge={room.participants.length} active={panel === 'people'} onPress={() => setPanel(p => (p === 'people' ? null : 'people'))} />
          <Ctrl label="Chat" Icon={MessageSquare} active={panel === 'chat'} onPress={() => setPanel(p => (p === 'chat' ? null : 'chat'))} />
          <Ctrl label="Leave" Icon={PhoneOff} danger onPress={onLeave} />
        </View>
      )}

      {panel === 'react' && (
        <View style={[styles.reactBar, { bottom: 100 + insets.bottom }]}>
          {REACTIONS.map(e => (
            <TouchableOpacity
              key={e}
              onPress={() => {
                sendReaction(e);
                setPanel(null);
              }}
            >
              <Text style={styles.reactEmoji}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <Sheet visible={panel === 'bg'} title="Background" onClose={() => setPanel(null)}>
        <View style={styles.bgRow}>
          {[
            { key: 'none', label: 'None', swatch: null },
            { key: 'black', label: 'Black', swatch: '#000' },
            { key: 'white', label: 'White', swatch: '#fff' },
          ].map(opt => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.bgOption, background === opt.key && styles.bgOptionOn]}
              onPress={() => setBackground(opt.key)}
            >
              <View
                style={[
                  styles.bgSwatch,
                  opt.swatch
                    ? { backgroundColor: opt.swatch }
                    : { borderWidth: 1, borderColor: '#4a5160' },
                ]}
              >
                {!opt.swatch && <X size={18} color="#6b7280" />}
              </View>
              <Text style={styles.bgLabel}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.bgHint}>
          Runs on the device. Costs battery, so turn it off when you don't need it.
        </Text>
      </Sheet>

      <Sheet visible={panel === 'chat'} title="Chat" onClose={() => setPanel(null)}>
        <FlatList
          data={messages}
          keyExtractor={(m, i) => `${m.ts}-${i}`}
          style={styles.chatList}
          renderItem={({ item: m }) =>
            m.system ? (
              <Text style={styles.chatSystem}>{m.text}</Text>
            ) : (
              <View style={styles.chatMsg}>
                <Text style={styles.chatName}>{m.name}</Text>
                <Text style={styles.chatText}>{m.text}</Text>
              </View>
            )
          }
        />
        <View style={styles.chatInputRow}>
          <TextInput
            style={styles.chatInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor="#6b7280"
            returnKeyType="send"
            onSubmitEditing={() => {
              if (draft.trim()) sendChat(draft.trim());
              setDraft('');
            }}
          />
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => {
              if (draft.trim()) sendChat(draft.trim());
              setDraft('');
            }}
          >
            <Send size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </Sheet>

      <Sheet
        visible={panel === 'people'}
        title={`People (${room.participants.length})`}
        onClose={() => setPanel(null)}
      >
        {/* Lock toggle + waiting queue — any moderator (host or co-host). */}
        {isModerator && (
          <View style={styles.modBar}>
            <TouchableOpacity
              style={[styles.lockBtn, room.locked && styles.lockBtnOn]}
              onPress={() => host.setLocked(!room.locked)}
            >
              {room.locked ? <Lock size={15} color="#fff" /> : <Unlock size={15} color="#eef1f6" />}
              <Text style={styles.lockText}>{room.locked ? 'Locked' : 'Lock meeting'}</Text>
            </TouchableOpacity>
            <Text style={styles.modHint}>
              {room.locked
                ? 'New people must be admitted.'
                : 'Anyone with the link can join.'}
            </Text>
          </View>
        )}

        {isModerator && room.waiting?.length > 0 && (
          <View style={styles.waitBox}>
            <Text style={styles.waitTitle}>Waiting to join</Text>
            {room.waiting.map(w => (
              <View key={w.id} style={styles.waitRow}>
                <Text style={styles.personName} numberOfLines={1}>{w.name}</Text>
                <TouchableOpacity style={styles.admitBtn} onPress={() => host.admit(w.id)}>
                  <Check size={14} color="#fff" />
                  <Text style={styles.admitText}>Admit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.denyBtn} onPress={() => host.deny(w.id)}>
                  <Text style={styles.denyText}>Deny</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <FlatList
          data={room.participants}
          keyExtractor={p => p.id}
          renderItem={({ item: p }) => {
            const isSelf = p.id === selfId;
            return (
              <View style={styles.personRow}>
                <View style={styles.personAvatar}>
                  <Text style={styles.avatarText}>{(p.name || '?')[0]?.toUpperCase()}</Text>
                </View>
                <Text style={styles.personName} numberOfLines={1}>
                  {p.name}
                  {isSelf ? ' (You)' : ''}
                </Text>
                {p.isHost && <Crown size={14} color="#f5b544" />}
                {p.isCoHost && <Shield size={14} color="#4f8cff" />}
                {!p.audio && <MicOff size={14} color="#f04747" />}
                {p.sharing && <MonitorUp size={14} color="#4f8cff" />}

                {/* Promote / demote — host only, never on the host. */}
                {isHost && !isSelf && !p.isHost && (
                  <TouchableOpacity
                    style={styles.roleBtn}
                    onPress={() => (p.isCoHost ? host.demote(p.id) : host.promote(p.id))}
                  >
                    <Shield size={13} color={p.isCoHost ? '#f04747' : '#4f8cff'} />
                  </TouchableOpacity>
                )}

                {/* Remove — any moderator, never the host. */}
                {isModerator && !isSelf && !p.isHost && (
                  <TouchableOpacity style={styles.kick} onPress={() => host.remove(p.id)}>
                    <Text style={styles.kickText}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      </Sheet>
    </View>
  );
}

function Ctrl({ label, Icon, onPress, off, active, danger, badge }) {
  const color = danger ? '#fff' : off ? '#ffb4b4' : active ? '#4f8cff' : '#eef1f6';
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.ctrl, off && styles.ctrlOff, active && styles.ctrlActive, danger && styles.ctrlDanger]}
    >
      <Icon size={20} color={color} />
      <Text style={[styles.ctrlLabel, danger && { color: '#fff' }]}>{label}</Text>
      {badge > 1 && (
        <View style={styles.badgeDot}>
          <Text style={styles.badgeDotText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function Sheet({ visible, title, children, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <X size={20} color="#98a1b0" />
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

function Message({ title, body, action, spinner }) {
  return (
    <View style={[styles.root, styles.centered]}>
      {spinner && <ActivityIndicator size="large" color="#4f8cff" />}
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
  root: { flex: 1, backgroundColor: '#0b0d12' },
  pipRoot: { flex: 1, backgroundColor: '#000' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pipBtn: { padding: 8, borderRadius: 10, backgroundColor: '#1e232d', borderWidth: 1, borderColor: '#2a2f3a' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1e232d',
    borderWidth: 1,
    borderColor: '#2a2f3a',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: { color: '#eef1f6', fontSize: 12 },
  headerText: { color: '#98a1b0', fontSize: 13, flexShrink: 1 },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#4f8cff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  inviteText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  notice: { backgroundColor: '#4f8cff', marginHorizontal: 12, padding: 8, borderRadius: 8 },
  noticeText: { color: '#fff', fontSize: 12, textAlign: 'center' },

  reactionOverlay: { position: 'absolute', top: 92, right: 16, zIndex: 5, gap: 4 },
  reactionFloat: { fontSize: 28 },

  stage: { flex: 1, padding: 4 },
  strip: { maxHeight: 116, flexGrow: 0 },
  stripInner: { paddingHorizontal: 4 },
  stripItem: { width: 158, height: 108 },

  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingVertical: 4 },
  pagerBtn: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1e232d' },
  dim: { opacity: 0.4 },
  pagerLabel: { color: '#98a1b0', fontSize: 12 },

  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: '#22252c',
  },
  ctrl: { alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6, borderRadius: 12, minWidth: 40 },
  ctrlOff: { backgroundColor: '#3a1f24' },
  ctrlActive: { backgroundColor: '#1d3357' },
  ctrlDanger: { backgroundColor: '#f04747' },
  ctrlLabel: { color: '#9aa2b1', fontSize: 9.5, marginTop: 3 },
  badgeDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#4f8cff',
    borderRadius: 8,
    minWidth: 15,
    alignItems: 'center',
  },
  badgeDotText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  exitImmersive: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00000099',
  },

  reactBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#161a22',
    borderWidth: 1,
    borderColor: '#2a2f3a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  reactEmoji: { fontSize: 26 },

  sheetBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#161a22',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '72%',
    paddingBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2f3a',
  },
  sheetTitle: { color: '#eef1f6', fontSize: 16, fontWeight: '600' },

  bgRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 18 },
  bgOption: { alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  bgOptionOn: { borderColor: '#4f8cff', backgroundColor: '#1d3357' },
  bgSwatch: { width: 56, height: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bgLabel: { color: '#eef1f6', fontSize: 13 },
  bgHint: { color: '#98a1b0', fontSize: 12, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 8 },

  chatList: { paddingHorizontal: 16, paddingTop: 10 },
  chatMsg: { marginBottom: 10 },
  chatName: { color: '#4f8cff', fontSize: 12, fontWeight: '600' },
  chatText: { color: '#eef1f6', fontSize: 14 },
  chatSystem: { color: '#98a1b0', fontSize: 12, fontStyle: 'italic', marginBottom: 8 },
  chatInputRow: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'center' },
  chatInput: {
    flex: 1,
    backgroundColor: '#0b0d12',
    borderWidth: 1,
    borderColor: '#2a2f3a',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
  },
  sendBtn: { backgroundColor: '#4f8cff', width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  personRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  personAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#333842', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  personName: { color: '#eef1f6', fontSize: 14, flex: 1 },
  kick: { backgroundColor: '#3a1f24', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  kickText: { color: '#ffb4b4', fontSize: 12 },
  roleBtn: { padding: 6, borderRadius: 8, backgroundColor: '#1e232d' },

  modBar: { paddingHorizontal: 16, paddingTop: 12 },
  lockBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: '#1e232d', borderWidth: 1, borderColor: '#2a2f3a', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  lockBtnOn: { backgroundColor: '#f04747', borderColor: '#f04747' },
  lockText: { color: '#eef1f6', fontSize: 13, fontWeight: '600' },
  modHint: { color: '#98a1b0', fontSize: 11, marginTop: 6 },

  waitBox: { paddingHorizontal: 16, paddingTop: 12, borderBottomWidth: 1, borderBottomColor: '#2a2f3a', paddingBottom: 8 },
  waitTitle: { color: '#98a1b0', fontSize: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  admitBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#4f8cff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  admitText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  denyBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#1e232d' },
  denyText: { color: '#98a1b0', fontSize: 12 },

  msgTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  msgBody: { color: '#9aa2b1', fontSize: 14, marginTop: 8, textAlign: 'center' },
  msgBtn: { marginTop: 18, backgroundColor: '#4f8cff', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  msgBtnText: { color: '#fff', fontWeight: '600' },
});
