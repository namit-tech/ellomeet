/**
 * Meet — mobile client.
 *
 * Joins the same rooms as the web app, against the same signalling server and
 * the same SFU. A phone and a laptop are peers here, not separate products.
 *
 * @format
 */

import React, { useState } from 'react';
import {
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

function App() {
  const [session, setSession] = useState<{ roomId: string; name: string } | null>(null);
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');

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
