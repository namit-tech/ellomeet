import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import signaling from "./signaling.test.mjs";
import validation from "./validation.test.mjs";
import livekit from "./livekit.test.mjs";
import cluster from "./cluster.test.mjs";

/**
 * Boots real signaling servers on scratch ports and drives them with real
 * socket clients. Run with `npm test` from server/.
 *
 * A SECOND instance is started only when REDIS_URL is set, because that is the
 * only configuration in which two instances can share anything. Without Redis
 * the cluster suite skips rather than passing vacuously.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_PORT || 3199);
const PORT_B = PORT + 1;
const URL = `http://localhost:${PORT}`;
const URL_B = `http://localhost:${PORT_B}`;

const REDIS_URL = process.env.REDIS_URL || "";

function startServer(port) {
  const proc = spawn(process.execPath, [path.join(__dirname, "..", "index.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      // Pin the cap so the capacity test stays meaningful regardless of the
      // production default. It exercises the mechanism, not the number.
      MAX_PEERS: "4",
      // Scratch credentials so token minting is exercised for real. These are
      // test-only and never reach a deployment.
      LIVEKIT_URL: "wss://test.invalid/livekit",
      LIVEKIT_API_KEY: "APItestkey",
      LIVEKIT_API_SECRET: "test_secret_that_is_at_least_32_chars_long",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Surface only server-side complaints; join/leave chatter is noise here.
  proc.stderr.on("data", (d) => process.stderr.write(`[server:${port}] ${d}`));
  return proc;
}

const servers = [startServer(PORT)];
if (REDIS_URL) servers.push(startServer(PORT_B));

const shutdown = (code) => {
  for (const s of servers) s.kill();
  process.exit(code);
};

// Poll /health rather than guessing at a startup delay. A fixed sleep is a
// race: it passes on a warm machine and fails on a cold one, and the failure
// looks like a broken assertion rather than a server that wasn't up yet.
async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`Server did not become healthy: ${url}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

(async () => {
  await waitForServer(URL);
  if (REDIS_URL) await waitForServer(URL_B);

  let failures = 0;
  try {
    failures += await signaling(URL);
    failures += await validation(URL);
    failures += await livekit(URL);
    failures += await cluster(URL, REDIS_URL ? URL_B : null);
  } catch (err) {
    console.error("\nTest run threw:", err);
    shutdown(1);
  }

  console.log(
    failures === 0 ? "\n✓ All checks passed." : `\n✗ ${failures} check(s) failed.`
  );
  shutdown(failures === 0 ? 0 : 1);
})();
