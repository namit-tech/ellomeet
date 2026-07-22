import { Room, VideoPresets, VideoQuality } from "livekit-client";

/**
 * How many tiles are rendered at once. Everything past this is not subscribed
 * at all, which is where the egress saving comes from — an unrendered tile
 * costs nothing but its owner's audio.
 *
 * Meet caps at 49 and Zoom at 25/49 per page for the same reason: past a couple
 * of dozen, tiles are too small to read and you are paying for pixels nobody
 * can see.
 */
export const GRID_PAGE_SIZE = 9; // even grid, nobody presenting
export const STRIP_PAGE_SIZE = 6; // filmstrip beside a spotlight

/**
 * The publisher's quality ceiling, chosen by room size.
 *
 * Simulcast already means thumbnails pull the 180p layer and only the spotlight
 * pulls the top one, and dynacast already stops encoding layers nobody wants.
 * What this adds is a bound on the worst case: in a large room *somebody* is
 * always spotlighted, so without a ceiling every publisher keeps a 720p encode
 * running. On a phone that is the difference between a call and a hand warmer.
 *
 * Deliberately only two tiers, and the floor is MEDIUM rather than LOW: a
 * spotlighted face at 180p is unusable, and the saving from 360p to 180p on the
 * publish side is small once dynacast is doing its job. The big win is 720 → 360,
 * which is roughly 2–3× on publisher upstream.
 */
export function publishQualityFor(participantCount) {
  return participantCount <= 6 ? VideoQuality.HIGH : VideoQuality.MEDIUM;
}

/**
 * The LiveKit room, configured with the scaling techniques described in
 * MOBILE_PLAN.md. These options are the whole reason an SFU reaches 20 people
 * where a mesh dies at 6, so they are set explicitly and commented rather than
 * left to defaults.
 */
export function createRoom() {
  return new Room({
    // Subscribe to the layer that matches the size the tile is actually drawn
    // at, and pause tracks whose element is off-screen entirely. This is what
    // stops a 20-tile grid from pulling 20 full-resolution streams.
    //
    // It only works if tracks are attached with track.attach(el) — setting
    // srcObject by hand bypasses the element observer and the video may never
    // start. See VideoTile.
    adaptiveStream: true,

    // Stop encoding layers nobody is subscribed to. On a laptop it saves
    // upstream; on a phone it is the difference between a call and a hand
    // warmer.
    dynacast: true,

    publishDefaults: {
      // Three spatial layers, so the SFU can hand a thumbnail 180p and the
      // spotlight 720p without ever transcoding.
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
      videoEncoding: VideoPresets.h720.encoding,

      // A screen is mostly static text, so resolution matters more than frame
      // rate — but never let the encoder starve it completely. This is the same
      // trade the mesh implementation reasoned about with contentHint, now
      // expressed as an explicit budget.
      screenShareEncoding: {
        maxBitrate: 3_000_000,
        maxFramerate: 30,
        priority: "high",
      },
      // Screen shares are not simulcast: there is only one consumer layout
      // that matters for a presentation, and layers would cost upstream for
      // nothing.
      screenShareSimulcastLayers: [],

      red: true, // redundant audio encoding — cheap, and audible on lossy links
      dtx: true, // stop sending during silence
    },

    videoCaptureDefaults: {
      resolution: VideoPresets.h720.resolution,
    },

    // Keep the connection alive across brief network changes (wifi to mobile)
    // rather than dropping the participant out of the meeting.
    reconnectPolicy: undefined, // library default is already exponential backoff
    disconnectOnPageLeave: true,
  });
}
