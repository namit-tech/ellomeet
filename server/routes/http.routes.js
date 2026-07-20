import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The HTTP surface is deliberately tiny — this is a realtime signaling server,
 * not a REST API. A health check, and (in production) the built client served
 * from the same origin, which mirrors the Nginx setup and keeps /socket.io on
 * the same host with no CORS or extra tunnel.
 */
export function registerHttpRoutes(app) {
  app.get("/health", (_req, res) => res.json({ ok: true }));

  const clientDist = path.join(__dirname, "..", "..", "client", "dist");
  if (!fs.existsSync(path.join(clientDist, "index.html"))) return;

  app.use(express.static(clientDist));
  // SPA fallback so refreshing /room/abc123 works. Socket.IO handles
  // /socket.io itself, so this never intercepts signaling.
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));

  console.log("Serving built client from", clientDist);
}
