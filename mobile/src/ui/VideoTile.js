import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { VideoTrack } from '@livekit/react-native';

/**
 * One tile: a participant's camera, or a participant's screen.
 *
 * Mirrors the web client's VideoTile — same roster-driven labels, same rule that
 * a screen is never mirrored and never cropped.
 *
 * VideoTrack (rather than a raw view fed a stream URL) is what keeps adaptive
 * stream working: LiveKit measures the rendered component to decide which
 * simulcast layer to pull, and pauses the track entirely when the tile is not
 * on screen. On a phone that is the difference between a usable 20-person call
 * and a dead battery.
 */
export default function VideoTile({
  track, // a LiveKit TrackReference, not a bare Track — see useCall
  participant,
  isLocal = false,
  isScreen = false,
  selected = false,
  speaking = false,
  onPress,
}) {
  const name = participant?.name || 'Guest';
  const micOff = participant ? !participant.audio : false;
  const camOff = participant ? !participant.video : false;
  const showPlaceholder = !isScreen && (!track || camOff);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.tile, selected && styles.tileSelected, speaking && styles.tileSpeaking]}
    >
      {track && (
        <VideoTrack
          trackRef={track}
          style={styles.video}
          // A screen is letterboxed; a face fills the frame.
          objectFit={isScreen ? 'contain' : 'cover'}
          mirror={isLocal && !isScreen}
        />
      )}

      {showPlaceholder && (
        <View style={styles.placeholder}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(name)}</Text>
          </View>
        </View>
      )}

      {isScreen && (
        <View style={styles.chip}>
          <Text style={styles.chipText}>Presenting</Text>
        </View>
      )}

      {participant?.hand && !isScreen && (
        <View style={[styles.chip, styles.chipHand]}>
          <Text style={styles.chipText}>✋</Text>
        </View>
      )}

      <View style={styles.nameBar}>
        <Text style={styles.nameText} numberOfLines={1}>
          {micOff && !isScreen ? '🔇 ' : ''}
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
    backgroundColor: '#16181d',
    borderWidth: 1,
    borderColor: '#2a2d35',
    minHeight: 120,
  },
  tileSelected: { borderColor: '#4c8dff' },
  tileSpeaking: { borderColor: '#4c8dff', borderWidth: 2 },
  video: { flex: 1, backgroundColor: '#000' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
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
    backgroundColor: '#4c8dff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  chipHand: { left: undefined, right: 8, backgroundColor: '#00000088' },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  nameBar: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: '#000000aa',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
    maxWidth: '90%',
  },
  nameText: { color: '#fff', fontSize: 12 },
});
