/**
 * Meet — mobile client.
 *
 * Joins the same rooms as the web app, against the same signalling server and
 * the same SFU. A phone and a laptop are peers here, not separate products.
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import {
  Image,
  Linking,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import CallScreen from './src/ui/CallScreen';

// Pull the room id out of a https://…/room/<id> link. Returns null for
// anything else, so an unrelated deep link can never drop someone into a call.
function roomFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/room\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function App() {
  const [session, setSession] = useState<{ roomId: string; name: string } | null>(null);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');

  // Opening a meet.elloindia.in/room/<id> link should land the user on the
  // pre-filled join screen, not the empty one. Two cases to cover:
  //   - app was launched BY the link  → getInitialURL()
  //   - app was already open           → the 'url' event
  useEffect(() => {
    Linking.getInitialURL().then(url => {
      const id = roomFromUrl(url);
      if (id) setRoomId(id);
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      const id = roomFromUrl(url);
      if (id) {
        setRoomId(id);
        // If they're mid-call in another room, drop back to join so the
        // pre-filled code is visible rather than silently ignored.
        setSession(null);
      }
    });
    return () => sub.remove();
  }, []);

  if (session) {
    return (
      <SafeAreaProvider>
        <CallScreen
          roomId={session.roomId}
          name={session.name}
          onLeave={() => setSession(null)}
        />
      </SafeAreaProvider>
    );
  }

  const canJoin = roomId.trim().length > 0;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor="#0d0f13" />
        <View style={styles.form}>
          <Image
            source={require('./src/assets/logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={styles.title}>Join a meeting</Text>

          <TextInput
            style={styles.input}
            placeholder="Room code"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            value={roomId}
            onChangeText={setRoomId}
          />
          <TextInput
            style={styles.input}
            placeholder="Your name"
            placeholderTextColor="#6b7280"
            value={name}
            onChangeText={setName}
          />

          <TouchableOpacity
            style={[styles.button, !canJoin && styles.buttonOff]}
            disabled={!canJoin}
            onPress={() =>
              setSession({ roomId: roomId.trim(), name: name.trim() || 'Guest' })
            }
          >
            <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0f13' },
  form: { flex: 1, justifyContent: 'center', padding: 28, gap: 14 },
  logo: { width: 200, height: 68, alignSelf: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 22, fontWeight: '600', marginBottom: 10 },
  input: {
    backgroundColor: '#16181d',
    borderWidth: 1,
    borderColor: '#2a2d35',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  button: {
    backgroundColor: '#4c8dff',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default App;
