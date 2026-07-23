import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VideoTrack } from '@livekit/react-native';
import {
  Crown,
  Hand,
  Maximize2,
  MicOff,
  MonitorUp,
  Pin,
  PinOff,
} from 'lucide-react-native';

/**
 * One tile: a participant's camera, or a participant's screen.
 *
 * Same rules as the web client — roster-driven labels, a screen is never
 * mirrored and never cropped — and the same icon set (lucide), so the two
 * clients look like one product.
 *
 * VideoTrack rather than a raw view is what keeps adaptive stream working:
 * LiveKit measures the rendered component to pick a simulcast layer and pauses
 * the track when the tile is off screen.
 */
export default function VideoTile({
  track, // a LiveKit TrackReference, not a bare Track — see useCall
  participant,
  isLocal = false,
  isScreen = false,
  mirror = false,
  selected = false,
  speaking = false,
  pinned = false,
  onPress,
  onTogglePin,
  onToggleFullscreen,
  showActions = false,
}) {
  const name = participant?.name || 'Guest';
  const micOff = participant ? !participant.audio : false;
  const camOff = participant ? !participant.video : false;
  const isHost = participant?.isHost;

  // Do not render the video at all when the camera is off. Leaving it mounted
  // is what leaves the last captured frame frozen on screen after someone
  // stops their camera.
  const showVideo = !!track && (isScreen || !camOff);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.tile, selected && styles.tileSelected, speaking && styles.tileSpeaking]}
    >
      {showVideo ? (
        <VideoTrack
          trackRef={track}
          style={styles.video}
          // A screen is letterboxed; a face fills the frame.
          objectFit={isScreen ? 'contain' : 'cover'}
          mirror={mirror}
        />
      ) : (
        // A flex child rather than an absolute overlay: with no video mounted
        // there is nothing to overlay, and absolute positioning left the avatar
        // pinned to the top of the tile instead of centred.
        <View style={styles.placeholder}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(name)}</Text>
          </View>
        </View>
      )}

      {isScreen && (
        <View style={styles.chip}>
          <MonitorUp size={12} color="#fff" />
          <Text style={styles.chipText}>Presenting</Text>
        </View>
      )}

      {participant?.hand && !isScreen && (
        <View style={styles.handChip}>
          <Hand size={14} color="#fff" />
        </View>
      )}

      {showActions && (
        <View style={styles.actions}>
          {onTogglePin && (
            <TouchableOpacity
              style={[styles.action, pinned && styles.actionOn]}
              onPress={onTogglePin}
              hitSlop={8}
            >
              {pinned ? <PinOff size={15} color="#fff" /> : <Pin size={15} color="#fff" />}
            </TouchableOpacity>
          )}
          {onToggleFullscreen && (
            <TouchableOpacity style={styles.action} onPress={onToggleFullscreen} hitSlop={8}>
              <Maximize2 size={15} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}

      <View style={styles.nameBar}>
        {micOff && !isScreen && <MicOff size={12} color="#f04747" />}
        {isHost && !isScreen && <Crown size={12} color="#f5b544" />}
        <Text style={styles.nameText} numberOfLines={1}>
          {isScreen ? `${name}'s screen` : name}
          {isLocal && !isScreen ? ' (You)' : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function initials(name) {
  return (name || '?')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    margin: 4,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#05070a',
    borderWidth: 1,
    borderColor: '#2a2f3a',
    minHeight: 110,
  },
  tileSelected: { borderColor: '#4f8cff' },
  tileSpeaking: { borderColor: '#4f8cff', borderWidth: 2 },
  video: { flex: 1, backgroundColor: '#000' },
  placeholder: {
    flex: 1,
    backgroundColor: '#05070a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#333842',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  chip: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#4f8cff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
  },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  handChip: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#000000aa',
    padding: 5,
    borderRadius: 7,
  },
  actions: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', gap: 6 },
  action: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00000099',
  },
  actionOn: { backgroundColor: '#4f8cff' },
  nameBar: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#000000aa',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    maxWidth: '90%',
  },
  nameText: { color: '#fff', fontSize: 12 },
});
