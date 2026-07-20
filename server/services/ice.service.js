/**
 * ICE / TURN credentials.
 *
 * The Metered API key stays on the server and is never sent to a browser: we
 * fetch short-lived credentials here and relay only the resulting ICE server
 * list to each client over the socket.
 */

const FALLBACK_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const TTL_MS = 5 * 60 * 1000;

export function createIceService({
  domain = process.env.METERED_DOMAIN || "",
  apiKey = process.env.METERED_API_KEY || "",
} = {}) {
  let cache = { at: 0, data: null };

  async function getIceServers() {
    // STUN alone fails on ~10-20% of real networks (symmetric NAT), so TURN is
    // not optional in production — but the app should still limp along without it.
    if (!apiKey || !domain) return FALLBACK_ICE;

    if (cache.data && Date.now() - cache.at < TTL_MS) return cache.data;

    try {
      const res = await fetch(
        `https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`
      );
      if (!res.ok) throw new Error(`Metered responded ${res.status}`);

      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error("Unexpected Metered response");

      cache = { at: Date.now(), data };
      return data;
    } catch (err) {
      console.warn("[ice] Metered fetch failed, using fallback STUN:", err.message);
      return cache.data || FALLBACK_ICE;
    }
  }

  return { getIceServers };
}
