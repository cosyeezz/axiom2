import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { FilePreview } from "../src/shared/file-preview.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { tmpdir } from "./temporary.js";

const root = mkdtempSync(join(tmpdir(), "axiom-prefix-preview-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/file-link-prefix");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  const suppliedFile = process.env.AXIOM_TEST_PREFIX_FILE;
  const filePath = suppliedFile || join(root, "latency-findings.md");
  if (!suppliedFile) writeFileSync(filePath, "# 耗时诊断\n\n存在的文件应正常显示，**零宽前缀**不应改变绝对路径。\n");
  const expected = readFileSync(filePath, "utf8"), canonical = realpathSync(filePath);
  const alias = process.platform === "darwin" && canonical.startsWith("/private/tmp/") ? canonical.slice("/private".length) : filePath;
  const href = "\u200c" + alias;
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  const views = (app.agents as unknown as { views: AgentViews }).views;
  views.messageChanged(scope, { id: "prefix-reply", role: "assistant", text: `详见[耗时诊断](${href})。` }); views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors: string[] = [], replies: Pick<FilePreview, "kind" | "path" | "size" | "encoding">[] = [];
  const requests = new Map<string, string>();
  let onReload: (() => void) | undefined;
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const command = JSON.parse(raw.toString());
      if (command.op === "files.document") requests.set(command.requestId, command.params.href);
      server.send(raw);
    });
    server.onMessage(raw => {
      const reply = JSON.parse(raw.toString());
      if (requests.has(reply.requestId)) {
        assert.equal(requests.get(reply.requestId), href);
        assert.equal(reply.ok, true, JSON.stringify(reply.error));
        const file = reply.data as FilePreview;
        assert.equal(file.path, canonical); assert.equal(file.kind, "markdown");
        assert.equal(file.text, expected);
        replies.push({ kind: file.kind, path: file.path, size: file.size, encoding: file.encoding });
        if (replies.length === 2) onReload?.();
      }
      socket.send(raw);
    });
  });
  await page.addInitScript(value => { sessionStorage.setItem("view", JSON.stringify(value)); }, scope);
  await page.goto(app.origin);
  await page.getByRole("button", { name: "耗时诊断", exact: true }).click();
  await page.locator(".file-reading h1").waitFor();
  assert.equal(await page.locator(".file-preview-body [role=alert]").count(), 0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByRole("button", { name: "Markdown 阅读", exact: true }).click();
    await page.screenshot({ path: join(artifacts, `reading-${width}.png`) });
    await page.getByRole("button", { name: "Markdown 源码", exact: true }).click();
    assert.equal(await page.locator(".file-source-code pre").innerText(), expected);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  }
  const reloaded = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Reload receipt timed out")), 10000);
    onReload = () => { clearTimeout(timer); resolve(); };
  });
  await page.getByRole("button", { name: "重新加载文件", exact: true }).click();
  await reloaded;
  await page.locator('.file-preview-body[aria-busy="false"]').waitFor();
  assert.equal(replies.length, 2); assert.deepEqual(errors, []);
  const result = { originalHref: href, prefix: "U+200C", canonical, replies, pageErrors: errors, widths: [1440, 390], suppliedFile: !!suppliedFile };
  writeFileSync(join(artifacts, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, artifacts }, null, 2));
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root, { recursive: true, force: true });
}
