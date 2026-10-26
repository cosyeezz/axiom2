// Render the real UI with explicitly fictional data, without calling a model.
// From the repository root: AXIOM_TEST_BROWSER=/path/to/chrome node --import tsx scripts/capture-readme.mts
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../app/src/server/index.ts";
import { memoryDirectory } from "../app/src/server/memory-files.ts";
import type { Session, Workspace } from "../app/src/shared/protocol.ts";

const repository = fileURLToPath(new URL("../", import.meta.url));
const output = join(repository, "docs/images/workbench-demo.png");
const previousDirectory = process.cwd(), previousPi = process.env.AXIOM_PI_DIR;
const root = mkdtempSync(join(tmpdir(), "axiom-demo-"));
let app: Awaited<ReturnType<typeof startServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  process.chdir(join(repository, "app"));
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(process.env.AXIOM_PI_DIR);
  const project = join(root, "example-project");
  mkdirSync(project);
  app = await startServer({ root, port: 0, dev: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.AXIOM_TEST_BROWSER });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
  const createSession = (title: string) => {
    const session = app!.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    app!.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", workspaceId: workspace.id, sessionId: session.id, params: { title } });
    return session;
  };
  const session = createSession("给登录流程补上测试");
  createSession("梳理项目架构");
  createSession("调查构建变慢的原因");
  const manager = SessionManager.create(project, join(root, "native"));
  manager.appendMessage({ role: "user", content: "先梳理登录流程的边界，再补上必要的测试。把关键决定记录下来，方便下次接着做。", timestamp: Date.now() });
  manager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: "## 先明确边界，再动手\n\n建议把这项工作拆成三个可验证的步骤：\n\n1. **梳理现状**：阅读登录入口、会话校验和已有测试。\n2. **明确边界**：区分凭据错误、会话过期和网络异常。\n3. **实施与验证**：补充实现与测试，记录命令、结果和未验证项。\n\n关键决定和后续工作保存在任务树，具体依据按步骤存入详情，便于后续会话查阅。\n\n> 这是用于展示阅读与任务树界面的示例内容，不是实际执行报告。", textSignature: JSON.stringify({ v: 1, id: crypto.randomUUID(), phase: "final_answer" }) }],
    stopReason: "stop", timestamp: Date.now(), api: "openai-responses", provider: "demo", model: "demo",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  });
  app.store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, manager.getSessionFile()!);
  const directory = memoryDirectory(root, session.id);
  mkdirSync(join(directory, "details", "完善登录流程"), { recursive: true });
  writeFileSync(join(directory, "MEMORY.md"), "# [In progress] 完善登录流程\n## [Completed] 梳理入口与依赖\n## [Completed] 确认异常处理边界\n## [In progress] 补充实现与测试\n### [Completed] 明确测试范围\n### [In progress] 覆盖会话过期\n### [Not started] 验证回归结果\n## [Not started] 汇总交付与限制\n");
  writeFileSync(join(directory, "details", "完善登录流程.md"), "示例目标：完善登录流程并验证边界。当前界面使用独立临时数据，没有调用模型或执行项目测试。");
  writeFileSync(join(directory, "details", "完善登录流程", "梳理入口与依赖.md"), "示例资料：核对登录入口、会话校验及相关测试。");
  app.agents.memories.scan();
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  const errors: string[] = [], operations: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const readOperations = new Set(["subscribe", "unsubscribe", "workspace.select", "session.view", "agent.environment", "agent.history.index", "costs.get", "processing.list", "read.cancel", "memory.read"]);
  await page.routeWebSocket("**", socket => {
    const server = socket.connectToServer();
    socket.onMessage(payload => {
      try {
        const frame = JSON.parse(String(payload));
        operations.push(String(frame.op));
        if (!readOperations.has(frame.op)) {
          errors.push(`Blocked unexpected browser operation: ${frame.op}`);
          return;
        }
        server.send(payload);
      } catch (error) {
        errors.push(`Invalid browser frame: ${error}`);
      }
    });
  });
  await page.addInitScript(scope => sessionStorage.setItem("view", JSON.stringify(scope)), { workspaceId: workspace.id, sessionId: session.id });
  await page.goto(app.origin);
  await page.getByText("先明确边界，再动手", { exact: true }).waitFor();
  await page.getByRole("button", { name: "上下文与会话记忆", exact: true }).click();
  await page.getByText("完善登录流程", { exact: true }).waitFor();
  await page.getByRole("button", { name: "查看完整记忆", exact: true }).click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(650);
  assert.deepEqual(errors, []);
  assert.ok(!operations.some(op => ["prompt", "agent.resume", "agent.send", "agent.retry"].includes(op)));
  mkdirSync(join(repository, "docs/images"), { recursive: true });
  await page.screenshot({ path: output });
  console.log(JSON.stringify({ output, fixture: true, errors, operations: [...new Set(operations)] }));
} finally {
  try { await browser?.close(); } finally {
    try { await app?.close(); } finally {
      process.chdir(previousDirectory);
      if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
      rmSync(root, { recursive: true, force: true });
    }
  }
}
