import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";

import { registerHttpRoutes } from "./routes/http.routes.js";
import { registerSocketRoutes } from "./routes/socket.routes.js";
import { RoomRegistry, DEFAULT_MAX_PEERS } from "./services/room.service.js";
import { createIceService } from "./services/ice.service.js";
import { createBroadcaster } from "./services/broadcast.service.js";

/**
 * Composition root — wiring only. The rules live in services/, the socket
 * handlers in controllers/, the protocol in routes/ + validation/.
 */
const PORT = process.env.PORT || 3001;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

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

const deps = {
  registry: new RoomRegistry(DEFAULT_MAX_PEERS),
  ice: createIceService(),
  broadcast: createBroadcaster(io),
};

registerSocketRoutes(io, deps);

server.listen(PORT, () => {
  console.log(
    `Signaling server listening on http://localhost:${PORT} (max ${DEFAULT_MAX_PEERS}/room)`
  );
});
