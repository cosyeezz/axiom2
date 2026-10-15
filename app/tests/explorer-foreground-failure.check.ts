// Disconnected/locked Windows desktop: real native helper, HTTP and UI must fail explicitly.
// This is failure-path coverage; it does not validate successful foreground activation or its latency.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

if (process.platform !== "win32") throw Error("Requires Windows with no interactive foreground desktop");
const root = mkdtempSync(join(tmpdir(), "axiom-foreground-failure-"));
const directory = join(root, "isolated-project"), pi = join(root, "pi");
const previousPi = process.env.AXIOM_PI_DIR;
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
function inspectDesktop() {
  // Read only: inspect full directory identities; never close any shell-owned window.
  const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ForegroundProbe { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$probeShell = New-Object -ComObject Shell.Application
$probeWindows = $null
$probeMatches = @()
try {
  $probeWindows = $probeShell.Windows()
  for ($probeIndex = 0; $probeIndex -lt $probeWindows.Count; $probeIndex++) {
    $probeItem = $null
    try {
      $probeItem = $probeWindows.Item($probeIndex)
      if ($null -eq $probeItem) { continue }
      $probeLocation = [Uri]$probeItem.LocationURL
      if ($probeLocation.IsFile -and $probeLocation.LocalPath.TrimEnd('\') -eq $env:AXIOM_FOREGROUND_FIXTURE.TrimEnd('\')) {
        $probeMatches += [long]$probeItem.HWND
      }
    } finally { if ($null -ne $probeItem) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($probeItem) } }
  }
  [pscustomobject]@{ foreground = [ForegroundProbe]::GetForegroundWindow().ToInt64(); windows = @($probeMatches) } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $probeWindows) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($probeWindows) }
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($probeShell)
}
`;
  const command = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const result = spawnSync(command, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    windowsHide: true, encoding: "utf8", timeout: 15_000, env: { ...process.env, AXIOM_FOREGROUND_FIXTURE: directory },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout.trim()) as { foreground: number; windows: number[] };
}
try {
  mkdirSync(directory); mkdirSync(pi);
  assert.deepEqual(inspectDesktop(), { foreground: 0, windows: [] }, "requires a disconnected/locked desktop and no test Explorer window");
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture", input: ["text"] }] } } }));
  writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "isolated-test-only" } }));
  process.env.AXIOM_PI_DIR = pi;
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: directory, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(view => sessionStorage.setItem("view", JSON.stringify(view)), scope);
  await page.goto(app.origin);
  await page.locator('.connection-status[data-connected="true"]').waitFor();
  await page.locator("#prompt").fill("保留当前输入");
  const view = await page.evaluate(() => sessionStorage.getItem("view"));
  const message = "无法将系统文件管理器切换到前台，请确认 Windows 桌面已连接并解锁后重试";
  const button = page.getByRole("button", { name: "打开系统文件管理器", exact: true });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator(".title-meta").hover();
    const response = page.waitForResponse("**/api/workspace/reveal?*");
    const started = performance.now();
    await button.click();
    const received = await response;
    assert.equal(received.status(), 503, "unavailable foreground must never report HTTP 204");
    assert.equal(await received.text(), message);
    const ms = Math.round(performance.now() - started);
    await page.locator(".execution-alert").filter({ hasText: message }).waitFor();
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('[aria-label="打开系统文件管理器"]')?.disabled === false);
    assert.equal(await button.getAttribute("aria-busy"), "false");
    assert.equal(await page.locator("#prompt").inputValue(), "保留当前输入");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("view")), view);
    assert.ok(ms < 1000, `failure feedback took ${ms} ms`);
    console.log(`PASS: real native foreground failure ${attempt}: HTTP 503 and visible retry feedback in ${ms} ms; draft and session preserved.`);
  }
  assert.deepEqual(inspectDesktop(), { foreground: 0, windows: [] }, "rejected requests must not create hidden directory windows");
  assert.deepEqual(errors, []);
  console.log("PASS: disconnected desktop is rejected before opening an Explorer window; retry uses a new native helper and preserves UI state.");
} finally {
  await browser?.close();
  await app?.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
