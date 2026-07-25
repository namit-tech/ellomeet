import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { generateRoomCode } from "../services/roomCode.js";
import { makeRoomKey, DEFAULT_TENANT } from "../services/roomKey.js";
import { hashPasscode } from "../services/passcode.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// How long a minted code may sit before its first join. Long enough to paste a
// link into chat and have someone open it; short enough that a leaked mint is
// not a standing reservation.
const CODE_TTL_MS = 15 * 60 * 1000;

/**
 * The HTTP surface is deliberately tiny — this is a realtime signaling server,
 * not a REST API. A health check, the room-mint endpoint, and (in production)
 * the built client served from the same origin.
 */
export function registerHttpRoutes(app, deps) {
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Mint a new room. The server chooses the code (unguessable, see roomCode.js)
  // and reserves it briefly so its first join may create the room. The client
  // can no longer pick or invent a code — that is what closes the "type 001 and
  // become the room" hole.
  //
  //   tenant   — namespaces the room (see roomKey.js). Two tenants may reuse the
  //              same code with no collision. Defaults to the public namespace.
  //   passcode — optional shared secret; stored hashed, required to join.
  //
  // The returned roomId is the composite key clients join with; tenant + code
  // are for building the /t/<tenant>/room/<code> URL.
  app.post("/rooms", async (req, res) => {
    const tenant = typeof req.body?.tenant === "string" ? req.body.tenant : DEFAULT_TENANT;
    const passcode = req.body?.passcode;

    const code = generateRoomCode();
    const roomId = makeRoomKey(tenant, code);
    const passcodeHash = passcode ? hashPasscode(String(passcode)) : null;

    await deps.registry.issueCode(roomId, { ttlMs: CODE_TTL_MS, passcodeHash });
    res.json({ tenant, code, roomId, hasPasscode: !!passcodeHash });
  });

  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  if (!fs.existsSync(path.join(clientDist, "index.html"))) return;

  app.use(express.static(clientDist));
  // SPA fallback so refreshing /room/abc123 works. Socket.IO handles
  // /socket.io itself, so this never intercepts signaling.
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

  console.log("Serving built client from", clientDist);
}
