import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { OpenCliService } from "../src/server/integrations/opencli.js";
import { extensionBrowserCommand, openCliExtensionUrls } from "../src/server/integrations/opencli-browser.js";
import { Store } from "../src/server/storage.js";

test("extension page launches once per receipt without an installation; rejects foreign scope and arbitrary targets", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-extension-page-"));
  const store = new Store(root);
  let opened = 0, fail = false;
  const targets: string[] = [];
  const service = new OpenCliService(root, () => {}, undefined, undefined, async (target = "store") => {
    targets.push(target);
    opened++;
    if (fail) throw Error("default browser unavailable");
  });
  const command = { requestId: randomUUID(), op: "opencli.openExtension", params: {} };
  try {
    await assert.rejects(service.command({ ...command, workspaceId: "foreign" }), { code: "INVALID_SCOPE" });
    await assert.rejects(service.command({ ...command, sessionId: "foreign" }), { code: "INVALID_SCOPE" });
    await assert.rejects(service.command({ ...command, params: { url: "file:///tmp/unsafe" } }), { code: "INVALID_PARAMS" });
    await assert.rejects(service.command({ ...command, params: { target: "https://example.com" } }), { code: "INVALID_PARAMS" });
    assert.equal(opened, 0);
    await store.external(command, () => service.command(command));
    await store.external(command, () => service.command(command));
    assert.equal(opened, 1);
    await service.command({ ...command, requestId: randomUUID(), params: { target: "download" } });
    assert.deepEqual(targets, ["store", "download"]);
    assert.equal(service.snapshot().job, undefined, "browser opening does not overwrite installation/diagnostic status");
    fail = true;
    await assert.rejects(service.command({ ...command, requestId: randomUUID() }), /default browser unavailable/);
    await service.close();
    await assert.rejects(service.command(command), { code: "CLOSING" });
  } finally {
    await service.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("extension pages use fixed HTTPS targets with platform launchers", () => {
  assert.deepEqual(openCliExtensionUrls, {
    store: "https://chromewebstore.google.com/detail/opencli/ildkmabpimmkaediidaifkhjpohdnifk",
    download: "https://github.com/jackwener/opencli/releases",
  });
  for (const target of ["store", "download"] as const) {
    const url = openCliExtensionUrls[target];
    const windows = extensionBrowserCommand("win32", "C:\\Windows", target);
    assert.equal(windows.file, join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
    assert.deepEqual(windows.args, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference = 'Stop'; Start-Process -FilePath '${url}'`]);
    assert.deepEqual(extensionBrowserCommand("darwin", undefined, target), { file: "/usr/bin/open", args: [url] });
    assert.deepEqual(extensionBrowserCommand("linux", undefined, target), { file: "xdg-open", args: [url] });
  }
});
