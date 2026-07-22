import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-streams-adapter";

import { registerHttpRoutes } from "./routes/http.routes.js";
import { registerSocketRoutes } from "./routes/socket.routes.js";
import { RoomRegistry, DEFAULT_MAX_PEERS } from "./services/room.service.js";
import { createMemoryStore } from "./services/store/memory.store.js";
import { createRedisStore } from "./services/store/redis.store.js";
import { createLiveKitService } from "./services/livekit.service.js";
import { createBroadcaster } from "./services/broadcast.service.js";

/**
 * Composition root — wiring only. The rules live in services/, the socket
 * handlers in controllers/, the protocol in routes/ + validation/.
 *
 * SINGLE INSTANCE vs CLUSTER is decided by one environment variable.
 *
 *   REDIS_URL unset  → in-memory rooms, no adapter. Correct and fast for one
 *                      server. This is the default, so nothing changes for a
 *                      small deployment.
 *   REDIS_URL set    → rooms in Valkey/Redis, and Socket.IO broadcasts routed
 *                      through it so a client on instance A hears an event
 *                      published on instance B.
 *
 * BOTH halves are required to scale out and neither is sufficient alone: the
 * adapter without shared state gives every instance its own idea of who is in
 * the room; shared state without the adapter means events never leave the
 * instance that produced them.
 */
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";
const REDIS_URL = process.env.REDIS_URL || "";

const app = express();
app.use(cors({ origin: CLIENT_ORIGIN }));
registerHttpRoutes(app);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ["GET", "POST"] },
});

io.engine.on("connection_error", (err) => {
  console.log(`[socket] handshake FAILED: ${err.code} ${err.message}`);
});

const store = REDIS_URL ? createRedisStore({ url: REDIS_URL }) : createMemoryStore();

if (store.kind === "redis") {
  // Streams rather than pub/sub: Redis pub/sub is fire-and-forget, so a client
  // reconnecting through a blip can miss messages entirely. A stream keeps an
  // acknowledged log.
  io.adapter(createAdapter(store.client));
  console.log("[cluster] Redis store + streams adapter enabled");
} else {
  console.log("[cluster] single instance (set REDIS_URL to scale out)");
}

const deps = {
  registry: new RoomRegistry(store),
  livekit: createLiveKitService(),
  broadcast: createBroadcaster(io),
};

registerSocketRoutes(io, deps);

server.listen(PORT, () => {
  console.log(
    `Signaling server listening on http://localhost:${PORT} (max ${DEFAULT_MAX_PEERS}/room)`
  );
});

// Close the store so Redis connections don't hold the process open.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await store.close();
    process.exit(0);
  });
}
