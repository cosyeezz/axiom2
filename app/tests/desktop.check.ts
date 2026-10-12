import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { startServer } from "../src/server/index.js";

if (process.platform !== "win32")
  throw Error(
    "This runtime check targets Windows UI Automation; other platforms require native acceptance.",
  );
const root = mkdtempSync(join(tmpdir(), "axiom-desktop-"));
const start = (
  await import(new URL("../dist/server/index.js", import.meta.url).href)
).startServer as typeof startServer;
const app = await start({ root: join(root, "data"), port: 0 });
mkdirSync("test-results", { recursive: true });
try {
  await new Promise<void>((done, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `& ([ScriptBlock]::Create([IO.File]::ReadAllText('${resolve("tests/desktop.windows.ps1").replaceAll("'", "''")}', [Text.Encoding]::UTF8)))`,
      ],
      {
        env: {
          ...process.env,
          AXIOM_DESKTOP_BINARY: resolve(
            process.env.AXIOM_DESKTOP_BINARY ?? "Axiom2.exe",
          ),
          AXIOM_DESKTOP_ACCESS: app.accessUrl,
          AXIOM_DESKTOP_SCREENSHOT: resolve(
            "test-results/desktop-connected.png",
          ),
          WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
        },
        stdio: "inherit",
      },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? done()
        : reject(Error(`Native desktop check failed (${code})`)),
    );
  });
  assert.equal(
    (await fetch(app.origin)).status,
    200,
    "closing client must not stop local service",
  );
  console.log(
    "PASS: Windows native connection, settings navigation, and client close without stopping the service. Remote OAuth not exercised.",
  );
} finally {
  await app.close();
  for (let i = 0; i < 30; i++) {
    try {
      rmSync(root, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
