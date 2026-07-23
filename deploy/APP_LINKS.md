# Android App Links — joining via the app from an invite link

The mobile app's **Invite** button shares `https://meet.elloindia.in/room/<id>`.
The goal: when the recipient has the app, that link opens the **app**; when they
don't, the same link opens the **web** meeting. One link, both audiences, no
"open with?" chooser.

That is exactly what Android App Links do, and they need two halves to agree:
the app declares which links it handles, and the website confirms it.

## The app half (already built)

`AndroidManifest.xml` has an `autoVerify` intent filter for
`https://meet.elloindia.in/room/*`, and `App.tsx` reads the incoming link and
pre-fills the room code on the join screen.

## The website half (you must deploy)

Android fetches a file that lists which apps may handle the domain's links.

### 1. Serve the file

`deploy/assetlinks.json` is already in the repo, carrying the **release**
signing certificate's SHA-256 fingerprint:

```
EA:F2:51:C4:8A:FD:FD:34:53:16:82:12:91:D5:3A:CB:2C:50:40:44:70:CE:56:BC:66:0F:68:A9:E3:AB:32:71
```

`deploy/nginx.conf` already maps it. After deploying the config it must be
reachable at exactly:

```bash
curl -s https://meet.elloindia.in/.well-known/assetlinks.json
```

Three things Android is strict about, and each one silently fails verification:

- **Content-Type must be `application/json`** (the nginx block sets this).
- **No redirect** — not even http→https on this specific path.
- **The fingerprint must match the key the APK was signed with.** These are the
  release credentials in `mobile/android/keystore.properties`. If you ever
  re-key the app, regenerate this file:
  ```bash
  keytool -list -v -keystore meet-release.keystore -alias meet | grep SHA256
  ```

### 2. Trigger verification

Verification runs automatically when the app installs from the Play Store. For a
sideloaded APK, force it:

```bash
adb shell pm verify-app-links --re-verify com.meetmobile
adb shell pm get-app-links com.meetmobile
```

The second command should show `meet.elloindia.in: verified`. Until the file is
live, it shows `1024` (verification pending/failed), and links open in the
browser instead — which is a graceful fallback, not a crash.

## Testing

```bash
# Simulate someone tapping the invite link:
adb shell am start -a android.intent.action.VIEW -d "https://meet.elloindia.in/room/test123"
```

With verification live and the app installed, this opens the app on the join
screen with `test123` already filled in. Without the app, the same link opens
the web meeting.

## A note on the "Open in app" nudge

Once this works, someone with the app installed goes straight there. Someone
without it lands on the web meeting — which works fine. If you later want the
web page to actively suggest installing the app, that is a banner on the web
client, separate from this; App Links alone do not prompt an install.
