/**
 * capabilities — what this browser can actually do, decided by feature
 * detection rather than by sniffing the user agent.
 *
 * The screen-share answer is the important one, and it is not a bug we can fix:
 * getDisplayMedia is a desktop-only API. No mobile browser implements it — not
 * Safari on iOS or iPadOS, not Chrome or Firefox on Android, not Samsung
 * Internet, regardless of how new the phone is. There is no permission to grant
 * and no flag to set; the operating systems do not expose a way for a web page
 * to capture the screen. Native apps do it through platform APIs (ReplayKit,
 * MediaProjection) that the web has no access to.
 *
 * So the honest behaviour is to detect it and say so, rather than show a button
 * that opens a picker which never appears.
 */

const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;

/** Can this browser capture a screen at all? */
export const canShareScreen = typeof md?.getDisplayMedia === "function";

/**
 * Rough "is this a phone or tablet" check, used ONLY to word the explanation —
 * never to decide whether the feature is available. Touch + no getDisplayMedia
 * is the giveaway; iPadOS deliberately reports itself as a Mac, so a plain UA
 * test gets tablets wrong.
 */
const isTouchDevice =
  typeof navigator !== "undefined" &&
  (navigator.maxTouchPoints > 1 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent));

/** Why sharing is unavailable, phrased for a tooltip. Null when it works. */
export function screenShareUnavailableReason() {
  if (canShareScreen) return null;
  if (isTouchDevice) {
    return "Screen sharing isn't supported by mobile browsers. Join from a computer to present.";
  }
  return "This browser can't share a screen. Try the latest Chrome, Edge, Firefox or Safari.";
}

/**
 * Fullscreen, with the vendor-prefixed spellings still needed in the wild.
 * Safari on iPhone never implements Element.requestFullscreen; the only thing
 * that can go fullscreen there is a <video>, via webkitEnterFullscreen.
 */
export function requestFullscreen(element, videoElement) {
  if (element?.requestFullscreen) return element.requestFullscreen().catch(() => {});
  if (element?.webkitRequestFullscreen) return element.webkitRequestFullscreen();
  if (videoElement?.webkitEnterFullscreen) return videoElement.webkitEnterFullscreen();
  return undefined;
}

export function exitFullscreen() {
  if (document.exitFullscreen) return document.exitFullscreen().catch(() => {});
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
  return undefined;
}

export function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
