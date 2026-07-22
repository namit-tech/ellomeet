# Meet — mobile client

React Native app joining the **same rooms, same signalling server and same SFU**
as the web client. A phone and a laptop are peers here, not separate products.

Screen sharing works on Android. iOS is not built yet — see the bottom.

## Prerequisites (Windows)

Android Studio provides everything; nothing else needs installing.

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
```

Make those permanent in your shell profile, or Gradle will not find a JDK.

`android/local.properties` must contain the SDK path (gitignored, machine-local):

```
sdk.dir=C:/Users/<you>/AppData/Local/Android/Sdk
```

## Running

```bash
npm install
npm start                     # Metro, in its own terminal
npx react-native run-android  # device or emulator
```

Or build an installable APK directly:

```bash
cd android && ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

## Pointing at a server

`src/media/signaling.js` holds `SIGNALING_URL`. It must be reachable **from the
device**, which is the thing that trips everyone up: `localhost` on a phone
means the phone. For a dev server on your machine, either use the LAN IP or
forward the port:

```bash
adb reverse tcp:3001 tcp:3001
```

## Known friction: OneDrive

If the repo lives in a OneDrive folder, Gradle intermittently fails with:

> Unable to delete directory … Failed to delete some children

OneDrive holds native build artifacts open mid-sync. Either exclude
`mobile/android/build` and `mobile/android/app/build` from sync, or keep the
repo outside OneDrive. Retrying after `./gradlew --stop` usually clears it, but
the real fix is to stop syncing build output.

## What differs from the web client

Same architecture — LiveKit carries media, our server carries the rules — with
only the differences a phone genuinely forces:

| | Web | Mobile |
|---|---|---|
| Virtual backgrounds | ✅ | ✗ no `<canvas>` for the processor |
| Camera choice | device picker | front/back flip |
| Screen share | `getDisplayMedia` | MediaProjection + foreground service |
| Audio routing | browser handles it | explicit `AudioSession` |

## Screen sharing on Android

`setScreenShareEnabled` drives MediaProjection. The pieces around it, all
already wired:

- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PROJECTION` permissions
- the capture service, declared by `@livekit/react-native-webrtc`
- `POST_NOTIFICATIONS` requested at runtime — Android 13+ needs it before the
  service can show its mandatory ongoing notification

The consent grant **cannot be persisted**; every session prompts again, by
design.

## iOS

Not built. It needs a Mac with Xcode, an Apple Developer account ($99/yr), and a
Broadcast Upload Extension as a second target with its own bundle ID and a
shared App Group. LiveKit ships boilerplate for it, which is the hard part
solved — but none of it can be compiled or verified from Windows.
