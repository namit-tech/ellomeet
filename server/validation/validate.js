/**
 * The validation seam between the socket transport and the controllers.
 *
 * A controller may assume its `data` argument has already been parsed and is
 * exactly the shape its schema describes. Anything that fails is dropped here,
 * logged once, and the sender is told — it never reaches domain code.
 */
export function validate(schema, handler) {
  return (ctx) => (payload) => {
    const result = schema.safeParse(payload);

    if (!result.success) {
      const detail = result.error.issues
        .map((i) => `${i.path.join(".") || "payload"}: ${i.message}`)
        .join("; ");

      console.warn(`[validation] rejected ${ctx.event} from ${ctx.socket.id} — ${detail}`);
      ctx.socket.emit("invalid-payload", { event: ctx.event, detail });
      return;
    }

    handler({ ...ctx, data: result.data });
  };
}
