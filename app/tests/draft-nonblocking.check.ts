// Run from app/: npx tsx tests/draft-nonblocking.check.ts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startServer } from "../src/server/index.js";
import { SessionDrafts } from "../src/server/session-drafts.js";
import type { Command, Session, Workspace } from "../src/shared/protocol.js";

const root = mkdtempSync(join(tmpdir(), "axiom-draft-nonblocking-"));
const previousPi = process.env.AXIOM_PI_DIR;
process.env.AXIOM_PI_DIR = join(root, "pi");
mkdirSync(process.env.AXIOM_PI_DIR);
const project = join(root, "project");
mkdirSync(project);
writeFileSync(join(process.env.AXIOM_PI_DIR, "models.json"), JSON.stringify({ providers: { fixture: {
  api: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", models: [{ id: "fixture", name: "Fixture", input: ["text"] }],
} } }));
writeFileSync(join(process.env.AXIOM_PI_DIR, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "test-only" } }));
const app = await startServer({ root: join(root, "data"), port: 0, dev: true });
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const drafts = new SessionDrafts(app.store);
  for (const mode of ["404", "405", "503", "invalid-json", "slow-read", "slow-write", "failed-write", "conflict"]) {
    const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    app.store.db.prepare("INSERT INTO agent_sessions(sessionId,selection) VALUES(?,?) ON CONFLICT(sessionId) DO UPDATE SET selection=excluded.selection")
      .run(session.id, JSON.stringify({ provider: "fixture", id: "fixture", thinking: "off" }));
    drafts.save(scope, { revision: 0, writer: "fixture", sequence: 1, draft: { text: "previous remote draft", attachment: null } });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [], sent: Command[] = [];
    let submitted!: () => void;
    const observed = new Promise<void>(resolve => { submitted = resolve; });
    page.on("pageerror", error => errors.push(error.message));
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/draft?*", async route => {
      const method = route.request().method();
      if (["404", "405", "503"].includes(mode)) return route.fulfill({ status: Number(mode), body: "" });
      if (mode === "invalid-json") return route.fulfill({ contentType: "application/json", body: "broken" });
      if (mode === "slow-read" && method === "GET" || mode === "slow-write" && method === "POST") await hold;
      if (mode === "failed-write" && method === "POST") return route.fulfill({ status: 503, body: "" });
      if (mode === "conflict" && method === "POST") return route.fulfill({ status: 409, contentType: "application/json",
        body: JSON.stringify({ code: "DRAFT_CONFLICT", error: "another window" }) });
      await route.continue();
    });
    await page.routeWebSocket("**/ws", route => {
      const server = route.connectToServer();
      route.onMessage(async raw => {
        const command = JSON.parse(raw.toString()) as Command;
        if (command.op !== "prompt") { server.send(raw); return; }
        sent.push(command);
        submitted();
        // Real admission receipts, no provider request or model worker.
        const data = await app.store.external(command, async () => ({ inputId: command.requestId }));
        route.send(JSON.stringify({ type: "receipt", requestId: command.requestId, ok: true, data }));
      });
      server.onMessage(raw => route.send(raw));
    });
    await page.addInitScript(owner => sessionStorage.setItem("view", JSON.stringify(owner)), scope);
    try {
      await page.goto(app.origin);
      const input = page.locator("#prompt");
      await input.waitFor();
      if (["slow-write", "failed-write", "conflict"].includes(mode)) {
        await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "previous remote draft");
      }
      await input.click();
      await input.fill(`send despite ${mode}`);
      assert.equal(await input.evaluate(node => document.activeElement === node), true);
      const attachment = page.getByRole("button", { name: "添加附件", exact: true });
      assert.equal(await attachment.isEnabled(), true);
      assert.equal(await attachment.evaluate(node => !!node.closest("[inert]")), false);
      if (mode === "conflict") await page.getByRole("button", { name: "载入已保存草稿", exact: true }).waitFor();
      // Enter reaches the real command path while optional requests are still held/failing.
      await input.press("Enter");
      await Promise.race([observed, page.waitForTimeout(3000).then(() => { throw Error(`${mode}: prompt blocked by draft persistence`); })]);
      await page.waitForFunction(() => (document.querySelector("#prompt") as HTMLTextAreaElement)?.value === "");
      assert.equal(sent.length, 1, `${mode}: exactly one prompt without waiting for draft HTTP`);
      assert.equal(sent[0].params!.text, `send despite ${mode}`);
      const savedTyping = mode === "slow-write" ? page.waitForResponse(response => response.url().includes("/api/draft?") && response.request().postDataJSON()?.draft.text === "typing after send") : undefined;
      await input.fill("typing after send");
      release();
      if (mode === "slow-read") await page.getByRole("button", { name: "载入已保存草稿", exact: true }).waitFor();
      if (mode === "slow-write") {
        await savedTyping;
        assert.equal(drafts.read(scope).draft.text, "typing after send", "late writes preserve newer text");
      }
      assert.equal(await input.inputValue(), "typing after send", "late recovery never replaces local input");
      assert.equal(await page.getByText(/无法读取草稿|正在恢复草稿|正在保存草稿|草稿已保存|请连接服务后重试/).count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS ${mode}: editable input, attachments, immediate send, newer typing retained, no draft failure banner`);
    } finally {
      release();
      await context.close();
    }
  }
} finally {
  await browser.close();
  await app.close();
  if (previousPi === undefined) delete process.env.AXIOM_PI_DIR;
  else process.env.AXIOM_PI_DIR = previousPi;
  rmSync(root, { recursive: true, force: true });
}
