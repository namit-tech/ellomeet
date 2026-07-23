import { useEffect, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

const { PipModule } = NativeModules;

/**
 * usePictureInPicture — keep the call alive in a floating window while the user
 * is in another app, and report whether we are currently in that window so the
 * UI can collapse to just the video.
 *
 * `active` should be true only while a call is mounted: it tells the native side
 * that pressing home should shrink into PiP rather than plain-background (which
 * would freeze your camera for everyone else).
 *
 * We listen via DeviceEventEmitter — the exact counterpart of the native
 * RCTDeviceEventEmitter.emit — rather than a NativeEventEmitter wrapper, which
 * under the new architecture can double-deliver or drop events. The native side
 * emits `true` on home-press (before PiP captures the surface) and a guaranteed
 * `false` on resume, so the collapse state never gets stuck out of sync.
 *
 * Android only; iOS video-call PiP is a separate per-view mechanism.
 */
export function usePictureInPicture(active) {
  const [inPip, setInPip] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !PipModule) return undefined;

    PipModule.setActive(!!active);
    const sub = DeviceEventEmitter.addListener('PipModeChanged', value =>
      setInPip(!!value),
    );

    return () => {
      sub.remove();
      PipModule.setActive(false);
    };
  }, [active]);

  return inPip;
}

/** Enter PiP on demand, e.g. from an in-call button. */
export function enterPip() {
  if (Platform.OS === 'android' && PipModule?.enter) PipModule.enter();
}
