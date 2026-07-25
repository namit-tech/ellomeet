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
import { createRoomCode } from './src/media/signaling';

// Parse a https://…/room/<code> or …/t/<tenant>/room/<code> link into its
// tenant and code. Returns null for anything else, so an unrelated deep link
// can never drop someone into a call.
function parseRoom(url: string | null): { tenant: string; code: string } | null {
  if (!url) return null;
  const t = url.match(/\/t\/([^/]+)\/room\/([^/?#]+)/);
  if (t) return { tenant: decodeURIComponent(t[1]), code: decodeURIComponent(t[2]) };
  const m = url.match(/\/room\/([^/?#]+)/);
  if (m) return { tenant: 'public', code: decodeURIComponent(m[1]) };
  return null;
}

function App() {
  const [session, setSession] = useState<{ roomId: string; name: string } | null>(null);
  const [code, setCode] = useState('');
  const [tenant, setTenant] = useState('public');
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  // Opening a room link should land the user on the pre-filled join screen, not
  // the empty one. Two cases: the app was launched BY the link (getInitialURL),
  // or it was already open (the 'url' event).
  useEffect(() => {
    Linking.getInitialURL().then(url => {
      const r = parseRoom(url);
      if (r) {
        setTenant(r.tenant);
        setCode(r.code);
      }
    });
    const sub = Linking.addEventListener('url', ({ url }) => {
      const r = parseRoom(url);
      if (r) {
        setTenant(r.tenant);
        setCode(r.code);
        // If they're mid-call, drop back to join so the pre-filled code shows.
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

  const canJoin = code.trim().length > 0;
  // The room's server identity is tenant-scoped; the field only shows the code.
  const roomKey = () => `${tenant}.${code.trim()}`;

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
            value={code}
            onChangeText={setCode}
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
              setSession({ roomId: roomKey(), name: name.trim() || 'Guest' })
            }
          >
            <Text style={styles.buttonText}>Join</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* The server mints the code; the app never invents one. */}
          <TouchableOpacity
            style={[styles.button, styles.buttonGhost, creating && styles.buttonOff]}
            disabled={creating}
            onPress={async () => {
              setCreating(true);
              try {
                const room = await createRoomCode();
                setSession({ roomId: room.roomId, name: name.trim() || 'Guest' });
              } catch (err) {
                console.warn('create failed', err);
              } finally {
                setCreating(false);
              }
            }}
          >
            <Text style={styles.buttonText}>{creating ? 'Creating…' : 'New meeting'}</Text>
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
  buttonGhost: { backgroundColor: '#16181d', borderWidth: 1, borderColor: '#2a2f3a' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#2a2f3a' },
  dividerText: { color: '#6b7280', fontSize: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

export default App;
