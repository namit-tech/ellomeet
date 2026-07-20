import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import signaling from "./signaling.test.mjs";
import validation from "./validation.test.mjs";

/**
 * Boots a real signaling server on a scratch port and drives it with real
 * socket clients. Run with `npm test` from server/.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.TEST_PORT || 3199;
const URL = `http://localhost:${PORT}`;

const server = spawn(
  process.execPath,
  [path.join(__dirname, "..", "index.js")],
  { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] }
);

// Surface only server-side complaints; the join/leave chatter is just noise here.
server.stderr.on("data", (d) => process.stderr.write(`[server] ${d}`));

const shutdown = (code) => {
  server.kill();
  process.exit(code);
};

setTimeout(async () => {
  let failures = 0;
  try {
    failures += await signaling(URL);
    failures += await validation(URL);
  } catch (err) {
    console.error("\nTest run threw:", err);
    shutdown(1);
  }

  console.log(
    failures === 0
      ? "\n✓ All checks passed."
      : `\n✗ ${failures} check(s) failed.`
  );
  shutdown(failures === 0 ? 0 : 1);
}, 1200);
