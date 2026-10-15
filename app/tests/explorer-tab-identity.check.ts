// Windows 11 regression: a unique UIA filename label can belong to a different directory.
// Real desktop.ini labels, three real tabs, and the production native FileManager; no host mocks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { join } from "node:path";
import { FileManager } from "../src/server/file-manager.js";
import { assertCentered, compileWindowProbe, observeNativeWindow, type NativeWindow } from "./native-open-probe.js";

if (process.platform !== "win32" || Number(release().split(".")[2]) < 22621)
  throw Error("Requires an unlocked Windows 11 desktop with Explorer tabs");
const root = mkdtempSync(join(tmpdir(), "axiom-tab-identity-"));
const directory = join(root, "requested-name"), decoyDirectory = join(root, "unrelated", "requested-name");
const displayName = "自定义显示名称 A";
const manager = new FileManager();
const observers: Awaited<ReturnType<typeof observeNativeWindow>>[] = [];
try {
  mkdirSync(directory); mkdirSync(decoyDirectory, { recursive: true }); mkdirSync(join(root, "other-tab"));
  const ini = join(directory, "desktop.ini");
  writeFileSync(ini, "\uFEFF[.ShellClassInfo]\r\nLocalizedResourceName=" + displayName + "\r\n", "utf16le");
  const attrib = join(process.env.SystemRoot || "C:\\Windows", "System32", "attrib.exe");
  for (const args of [["+h", "+s", ini], ["+r", directory]]) {
    const result = spawnSync(attrib, args, { windowsHide: true, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const probe = compileWindowProbe(root);
  await manager.prepare();
  let original: NativeWindow | undefined;
  for (const state of [undefined, "inactive-tab"] as const) {
    const observer = await observeNativeWindow(probe, "", { directory, displayName, state, decoyDirectory: state ? decoyDirectory : undefined });
    observers.push(observer);
    const start = performance.now();
    const opened = manager.open(directory, new AbortController().signal);
    void opened.catch(() => {});
    const visible = await observer.next();
    const ms = Math.round(performance.now() - start);
    assertCentered(visible);
    assert.equal(visible.foreground, visible.handle, "requested directory is in the foreground");
    const settled = await observer.next();
    assertCentered(settled);
    assert.equal(settled.foreground, settled.handle, "requested directory stays in the foreground after layout");
    await opened;
    if (!state) original = visible;
    else assert.notEqual(visible.handle, original!.handle, "the custom-named target must open separately from all three existing tabs");
    assert.ok(ms < 1000, `${state ?? "custom-name first open"} took ${ms} ms`);
    console.log(`PASS: ${state ?? "custom-name first open"}: ${ms} ms; correct directory in foreground and centered.`);
  }
  // Probe close also verifies that the original third tab and its bounds stayed unchanged.
  for (const observer of [...observers].reverse()) await observer.close();
  console.log("PASS: the target's custom display name differs from its filesystem name; the unique filename label belongs to another tab; the original third tab and window bounds are preserved.");
} finally {
  await manager.close();
  const results = await Promise.allSettled(observers.map(observer => observer.close()));
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
