import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

// --- TURN / ICE servers --------------------------------------------------
// The Metered API key stays HERE on the server (never sent to the browser).
// We fetch short-lived TURN credentials from Metered and relay just the
// resulting ICE server list to each client over the socket.
const METERED_DOMAIN = process.env.METERED_DOMAIN || "";
const METERED_API_KEY = process.env.METERED_API_KEY || "";

const FALLBACK_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

let iceCache = { at: 0, data: null };
const ICE_TTL_MS = 5 * 60 * 1000; // refresh at most every 5 minutes

async function fetchIceServers() {
  if (!METERED_API_KEY || !METERED_DOMAIN) return FALLBACK_ICE;

  const fresh = iceCache.data && Date.now() - iceCache.at < ICE_TTL_MS;
  if (fresh) return iceCache.data;

  try {
    const url = `https://${METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${METERED_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Metered responded ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      iceCache = { at: Date.now(), data };
      return data;
    }
    throw new Error("Unexpected Metered response");
  } catch (err) {
    console.warn("[ice] Metered fetch failed, using fallback STUN:", err.message);
    return iceCache.data || FALLBACK_ICE;
  }
}

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));

// --- TEMP diagnostics: log page + socket.io requests (skip static assets) ---
app.use((req, _res, next) => {
  if (!/\.(js|css|wasm|data|tflite|binarypb|png|svg|ico|map)$/i.test(req.url)) {
    console.log(`[http] ${req.method} ${req.url}`);
  }
  next();
});

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

// Serve the built client on the SAME origin (mirrors the production Nginx
// setup). Only active once you've run `npm run build` in ../client — in dev you
// still use the Vite server on :5173 instead. This makes single-tunnel testing
// (e.g. cloudflared) and production behave identically.
const clientDist = path.join(__dirname, "..", "client", "dist");
if (fs.existsSync(path.join(clientDist, "index.html"))) {
  app.use(express.static(clientDist));
  // SPA fallback so refreshing /room/abc123 works. Socket.IO handles
  // /socket.io itself, so this never interferes with signaling.
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  console.log("Serving built client from", clientDist);
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

// TEMP diagnostics: log every raw socket connection and handshake failure.
io.engine.on("connection_error", (err) => {
  console.log(`[socket] handshake FAILED: ${err.code} ${err.message}`);
});

// roomId -> Map<socketId, { name }>
const rooms = new Map();

function getPeers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.entries()].map(([id, meta]) => ({ id, name: meta.name }));
}

io.on("connection", (socket) => {
  let joinedRoom = null;
  console.log(`[socket] connected ${socket.id} (transport: ${socket.conn.transport.name})`);

  // Hand this client its ICE/TURN servers (API key never leaves the server).
  fetchIceServers().then((iceServers) => socket.emit("ice-servers", { iceServers }));

  // A client asks to join a meeting room.
  socket.on("join", ({ roomId, name }) => {
    roomId = String(roomId || "").trim();
    if (!roomId) return;

    joinedRoom = roomId;
    socket.data.name = name || "Guest";

    if (!rooms.has(roomId)) rooms.set(roomId, new Map());
    const room = rooms.get(roomId);

    // Cap the mesh at 4 participants — beyond that P2P mesh degrades badly.
    if (room.size >= 4) {
      socket.emit("room-full");
      return;
    }

    socket.join(roomId);

    // Send the new arrival the list of people ALREADY in the room.
    // The newcomer is responsible for initiating the offer to each of them.
    socket.emit("peers", { peers: getPeers(roomId) });

    room.set(socket.id, { name: socket.data.name });

    // Tell existing members that someone new joined (they wait for the offer).
    socket.to(roomId).emit("peer-joined", { id: socket.id, name: socket.data.name });

    console.log(`[join] ${socket.data.name} (${socket.id}) -> room ${roomId} (${room.size} in room)`);
  });

  // Relay signaling messages verbatim to a specific peer.
  socket.on("offer", ({ to, sdp }) => {
    io.to(to).emit("offer", { from: socket.id, sdp, name: socket.data.name });
  });

  socket.on("answer", ({ to, sdp }) => {
    io.to(to).emit("answer", { from: socket.id, sdp });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // Lightweight in-room chat relayed through the server.
  socket.on("chat", ({ text }) => {
    if (!joinedRoom || !text) return;
    io.to(joinedRoom).emit("chat", {
      from: socket.id,
      name: socket.data.name,
      text: String(text).slice(0, 2000),
      ts: Date.now(),
    });
  });

  function leave() {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) rooms.delete(joinedRoom);
    }
    socket.to(joinedRoom).emit("peer-left", { id: socket.id });
    console.log(`[leave] ${socket.id} <- room ${joinedRoom}`);
    joinedRoom = null;
  }

  socket.on("leave", leave);
  socket.on("disconnect", leave);
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on http://localhost:${PORT}`);
});
