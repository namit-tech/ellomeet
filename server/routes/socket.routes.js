import { validate } from "../validation/validate.js";
import {
  JoinSchema, StateSchema, ChatSchema, ReactionSchema,
  OfferSchema, AnswerSchema, IceCandidateSchema,
  HostTargetSchema, HostLockSchema,
} from "../validation/schemas.js";

import * as room from "../controllers/room.controller.js";
import * as signal from "../controllers/signal.controller.js";
import * as host from "../controllers/host.controller.js";
import * as chat from "../controllers/chat.controller.js";

/**
 * The routing table: every event a client may send, the schema its payload must
 * satisfy, and the controller that handles it. Anything not listed here is
 * simply not part of the protocol.
 */
const routes = [
  { event: "join", schema: JoinSchema, handler: room.join },
  { event: "state", schema: StateSchema, handler: room.updateState },
  { event: "reaction", schema: ReactionSchema, handler: room.react },

  { event: "offer", schema: OfferSchema, handler: signal.offer },
  { event: "answer", schema: AnswerSchema, handler: signal.answer },
  { event: "ice-candidate", schema: IceCandidateSchema, handler: signal.iceCandidate },

  { event: "chat", schema: ChatSchema, handler: chat.send },

  { event: "host:mute", schema: HostTargetSchema, handler: host.mute },
  { event: "host:remove", schema: HostTargetSchema, handler: host.remove },
  { event: "host:admit", schema: HostTargetSchema, handler: host.admitOne },
  { event: "host:deny", schema: HostTargetSchema, handler: host.deny },
  { event: "host:lock", schema: HostLockSchema, handler: host.lock },
];

export function registerSocketRoutes(io, deps) {
  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id}`);

    // Hand the client its TURN/STUN list up front, so the very first peer
    // connection already has it. The API key never leaves this process.
    deps.ice
      .getIceServers()
      .then((iceServers) => socket.emit("ice-servers", { iceServers }));

    for (const { event, schema, handler } of routes) {
      socket.on(event, validate(schema, handler)({ socket, event, deps }));
    }

    // These carry no payload, so there is nothing to validate.
    socket.on("host:end", () => host.end({ socket, deps }));
    socket.on("leave", () => room.leave({ socket, deps }));
    socket.on("disconnect", () => room.leave({ socket, deps }));
  });
}
