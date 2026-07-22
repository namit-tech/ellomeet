import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Android runtime permissions.
 *
 * Declaring these in the manifest is only half of it — camera, mic and
 * notifications are all "dangerous" permissions that must also be granted at
 * runtime, and getUserMedia fails with a bare error if they were never asked
 * for.
 *
 * POST_NOTIFICATIONS matters more than it looks: screen capture runs inside a
 * foreground service, a foreground service must post an ongoing notification,
 * and on Android 13+ a denied notification permission means that service cannot
 * show it. Ask for it up front rather than at the moment someone presses Share.
 */
export async function requestCallPermissions() {
  if (Platform.OS !== 'android') return true;

  const wanted = [
    PermissionsAndroid.PERMISSIONS.CAMERA,
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  ];

  if (Platform.Version >= 33) {
    wanted.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  }

  try {
    const result = await PermissionsAndroid.requestMultiple(wanted);
    // Notifications being refused is survivable — the call still works, you
    // just get a worse screen-share experience. Camera and mic are not.
    return (
      result[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted' &&
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted'
    );
  } catch (err) {
    console.warn('Permission request failed:', err);
    return false;
  }
}
