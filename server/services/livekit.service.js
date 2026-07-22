import { AccessToken } from "livekit-server-sdk";

/**
 * LiveKit access tokens.
 *
 * The SFU carries media; this server keeps the rules. A token is the seam
 * between the two, and it is what stops someone from wandering into a meeting
 * they were never admitted to — LiveKit itself has no idea about our waiting
 * room, our lock, or our host.
 *
 * Two properties matter and neither is optional:
 *
 *   1. The API secret never leaves this process. Tokens are minted here and
 *      relayed over the socket, exactly like the TURN credentials in
 *      ice.service.js.
 *   2. A token is issued ONLY from `admit()` — the single point where someone
 *      genuinely becomes a member. Knocking at a locked room gets you a
 *      "waiting" event and no token, so being stuck in the lobby is enforced by
 *      the absence of a credential rather than by client-side politeness.
 *
 * The grant is scoped to one room and one identity. It cannot be replayed
 * against another room, and it expires.
 */

// Long enough that a meeting doesn't die mid-sentence, short enough that a
// leaked token isn't a standing invitation.
const TTL = "6h";

export function createLiveKitService({
  url = process.env.LIVEKIT_URL || "",
  apiKey = process.env.LIVEKIT_API_KEY || "",
  apiSecret = process.env.LIVEKIT_API_SECRET || "",
} = {}) {
  const configured = !!(url && apiKey && apiSecret);

  if (!configured) {
    console.warn("[livekit] not configured — set LIVEKIT_URL / _API_KEY / _API_SECRET");
  }

  /**
   * @param {string} roomId
   * @param {string} identity  stable per participant; we use the socket id
   * @param {string} name      display name
   * @returns {Promise<{url: string, token: string}|null>} null when unconfigured
   */
  async function issueToken(roomId, identity, name) {
    if (!configured) return null;

    try {
      const at = new AccessToken(apiKey, apiSecret, { identity, name, ttl: TTL });

      at.addGrant({
        room: roomId,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        // Room lifecycle is ours to decide, not a participant's. Without this a
        // client could create rooms we never admitted anyone to.
        roomCreate: false,
        roomAdmin: false,
      });

      // toJwt() is async in the v2 SDK — awaiting it is not optional, or the
      // client receives "[object Promise]" and fails to connect.
      const token = await at.toJwt();
      return { url, token };
    } catch (err) {
      console.error("[livekit] token mint failed:", err.message);
      return null;
    }
  }

  return { issueToken, configured };
}
