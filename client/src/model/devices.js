// Camera / mic / speaker enumeration.
//
// Device *labels* are only exposed after the page has been granted media
// permission once — so always call this after a getUserMedia(), otherwise you
// get a list of anonymous "" entries.

export async function listDevices() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const pick = (kind, fallback) =>
      all
        .filter((d) => d.kind === kind && d.deviceId)
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));

    return {
      cameras: pick("videoinput", "Camera"),
      mics: pick("audioinput", "Microphone"),
      speakers: pick("audiooutput", "Speaker"),
    };
  } catch {
    return { cameras: [], mics: [], speakers: [] };
  }
}

// Choosing an output device is Chromium-only (HTMLMediaElement.setSinkId).
export const canChooseSpeaker =
  typeof HTMLMediaElement !== "undefined" &&
  "setSinkId" in HTMLMediaElement.prototype;

const KEY = "meet:devices";

export function loadDevicePrefs() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

export function saveDevicePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // storage disabled — preferences just won't persist
  }
}
