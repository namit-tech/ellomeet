import { validate } from "../validation/validate.js";
import {
  JoinSchema, StateSchema, ChatSchema, ReactionSchema,
  HostTargetSchema, HostLockSchema,
} from "../validation/schemas.js";

import * as room from "../controllers/room.controller.js";
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

  { event: "chat", schema: ChatSchema, handler: chat.send },

  { event: "host:mute", schema: HostTargetSchema, handler: host.mute },
  { event: "host:remove", schema: HostTargetSchema, handler: host.remove },
  { event: "host:admit", schema: HostTargetSchema, handler: host.admitOne },
  { event: "host:deny", schema: HostTargetSchema, handler: host.deny },
  { event: "host:lock", schema: HostLockSchema, handler: host.lock },
  { event: "host:promote", schema: HostTargetSchema, handler: host.promote },
  { event: "host:demote", schema: HostTargetSchema, handler: host.demote },
];

export function registerSocketRoutes(io, deps) {
  io.on("connection", (socket) => {
    console.log(`[socket] connected ${socket.id}`);

    for (const { event, schema, handler } of routes) {
      socket.on(event, validate(schema, handler)({ socket, event, deps }));
    }

    // These carry no payload, so there is nothing to validate — but they are
    // async, so their rejections still need catching or they kill the process.
    const guard = (fn) => () =>
      Promise.resolve(fn()).catch((err) => console.error("[handler]", err));

    socket.on("host:end", guard(() => host.end({ socket, deps })));
    socket.on("leave", guard(() => room.leave({ socket, deps })));
    socket.on("disconnect", guard(() => room.leave({ socket, deps })));
  });
}
