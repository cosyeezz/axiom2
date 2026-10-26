// A real detached child and HTTP listener, with file gates making startup races deterministic.
import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { start, stop, status, serve, root } from "./service.mjs";

async function gate(name) {
  for (;;) {
    try { await stat(join(root, name)); return; } catch (error) { if (error.code !== "ENOENT") throw error; }
    await delay(20);
  }
}
try {
  const action = process.argv[2];
  if (action === "--daemon") {
    const messages = [];
    const buffer = (message) => messages.push(message);
    process.on("message", buffer);
    await writeFile(join(root, "child-entered"), String(process.pid));
    await gate("bootstrap-gate");
    process.removeListener("message", buffer);
    const serving = serve(true, { initialize: async ({ port }) => {
      await writeFile(join(root, "initializing"), "");
      await gate("initialize-gate");
      const server = createServer((_req, res) => res.end("ready"));
      await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
      await writeFile(join(root, "listened"), "");
      return {
        accessUrl: `http://127.0.0.1:${port}/`,
        store: { db: { prepare: () => ({ all: () => [] }) } },
        close: async () => {
          await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
          await writeFile(join(root, "closed"), "");
        },
      };
    } });
    for (const message of messages) process.emit("message", message);
    await serving;
  } else {
    const result = await ({ start, stop, status }[action])({ timeoutMs: Number(process.env.TEST_CONTROL_TIMEOUT || 15000) });
    console.log(JSON.stringify(result));
  }
} catch (error) {
  console.log(JSON.stringify({ state: "error", message: error.message }));
  process.exitCode = 1;
}
