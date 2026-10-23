import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "./temporary.js";
import { dirname, join, resolve } from "node:path";
import { chromium, type Browser } from "playwright";
import { startServer } from "../src/server/index.js";
import { fixtureZip, wordFixture, sheetFixture, slidesFixture, wavFixture } from "./preview-fixtures.js";
import type { AgentViews } from "../src/server/agents/views.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
const root = mkdtempSync(join(tmpdir(), "axiom-file-preview-ui-"));
const artifacts = resolve(process.env.AXIOM_TEST_ARTIFACTS || "test-results/file-preview");
mkdirSync(artifacts, { recursive: true }); mkdirSync(join(root, "pi"));
const previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = join(root, "pi");
let app: Awaited<ReturnType<typeof startServer>> | undefined, browser: Browser | undefined;
try {
  const markdown = "# 文件预览，让阅读留在会话里\n\n这是一份真实的 **中文 Markdown 文档**。源码与排版可以并排查看，拖动中间分隔线，调整适合自己的阅读宽度。\n\n## 一处打开，专注阅读\n\n- 左侧保留对话线索\n- 底部输入框始终可用\n- 保存前校验文件修订，随时重新加载\n\n> 好的阅读体验，应该让内容本身成为主角。\n\n| 文件类型 | 预览方式 |\n| --- | --- |\n| Markdown | 源码 / 对比 / 阅读 |\n| TypeScript | 代码与行号 |\n| 图片 | 适应与缩放 |\n\n```typescript\nconst preview = { mode: 'reading', editable: true };\n```\n\n<script>window.previewUnsafe = true</script>\n\n[文档内部文件](secret.txt)\n\n[内部锚点](#section) · [其他文档片段](secret.md#section)\n\n" + Array.from({ length: 25 }, (_, i) => `### 细节 ${i + 1}\n\n持续输入与阅读互不干扰，文档内容保持独立滚动。\n`).join("\n");
  writeFileSync(join(root, "设计说明.md"), markdown);
  writeFileSync(join(root, "large.txt"), "x".repeat(250000));
  writeFileSync(join(root, "spec#1.md"), "# 带井号的文件名");
  const pdfStream = "BT /F1 18 Tf 40 430 Td (Axiom PDF file preview) Tj ET\n";
  const pdfObjects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 500] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(pdfStream)} >>\nstream\n${pdfStream}endstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  pdfObjects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  writeFileSync(join(root, "preview.pdf"), pdf);
  writeFileSync(join(root, "example.ts"), "const title = '中文文件内容';\n" + Array.from({ length: 60 }, (_, i) => `export const value${i} = ${i};`).join("\n"));
  writeFileSync(join(root, "legacy.txt"), Buffer.from([0xd6, 0xd0, 0xce, 0xc4]));
  writeFileSync(join(root, "report.docx"), wordFixture());
  writeFileSync(join(root, "data.xlsx"), sheetFixture()); writeFileSync(join(root, "slides.pptx"), slidesFixture());
  writeFileSync(join(root, "sound.wav"), wavFixture()); writeFileSync(join(root, "files.zip"), fixtureZip({ "folder/note.txt": "压缩包成员内容", "readme.md": "# 归档正文" }));
  mkdirSync(join(root, "runtime"));
  writeFileSync(join(root, "runtime", "index.html"), `<h1>模块网页</h1><script type="module">import { value } from "/module.js";const part="data";const data=await fetch("/"+part+".json").then(r=>r.json());const more=await import("/"+"other.mjs");document.body.dataset.result=value+data.value+more.value;try{parent.document.body.dataset.bad="yes"}catch{document.body.dataset.isolated="yes"}</script>`);
  writeFileSync(join(root, "runtime", "module.js"), Array.from({length:12},(_,i)=>`import { n as n${i} } from "/dep${i}.js";`).join("\n")+'export const value = "模块" + String.raw`/原文` + (n0+n11);');
  for(let i=0;i<12;i++) writeFileSync(join(root,"runtime",`dep${i}.js`), `export const n=${i};`);
  writeFileSync(join(root, "runtime", "data.json"), '{"value":"动态请求"}'); writeFileSync(join(root, "runtime", "other.mjs"), 'export const value="动态模块";');
  mkdirSync(join(root,"project"));
  writeFileSync(join(root,"project","package.json"), JSON.stringify({ scripts:{ dev:`"${process.execPath}" server.cjs` } }));
  writeFileSync(join(root,"project","server.cjs"), `require('node:http').createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<h1>临时项目运行成功</h1>')}).listen(Number(process.env.PORT),process.env.HOST);`);
  writeFileSync(join(root, "unsafe.html"), `<!doctype html><html lang="zh-CN"><head><link rel="stylesheet" href="p&#97;ge.css?a=1&amp;b=2"><script defer src="page.js"></script></head><body><h1>HTML 页面已显示</h1><button id="counter">点击 0</button><img id="local-image" src="picture.png" width="60" height="120"><img id="local-svg" src="icon.svg" width="30" height="30"><div id="css-background">背景与字体</div><div id="inline-background" style="background-image:url(&quot;picture.png&quot;);width:20px;height:20px"></div><style>#style-background{background-image:url(picture.png);width:20px;height:20px}</style><div id="style-background"></div><img src="missing-asset.png" hidden><textarea hidden><link rel='stylesheet' href='page.css'></textarea><script>
    const fragment = "<link rel='stylesheet' href='page.css'>";
    document.body.dataset.literal = fragment;
    window.previewUnsafe = true;
    try { parent.document.body.dataset.unsafe = 'true'; } catch { document.body.dataset.parentBlocked = 'true'; }
    try { localStorage.setItem('unsafe', 'true'); } catch { document.body.dataset.storageBlocked = 'true'; }
    fetch('/api/status').then(() => document.body.dataset.networkBlocked = 'false', () => document.body.dataset.networkBlocked = 'true');
    let clicks = 0; document.querySelector('#counter').onclick = event => event.target.textContent = '点击 ' + ++clicks;
  </script></body></html>`);
  writeFileSync(join(root, "page.css"), "body { background: rgb(235, 245, 250); padding: 24px; } h1 { color: rgb(20, 60, 90); } @font-face { font-family: PreviewTest; src: url(preview.woff2); } #css-background { background-image: url(picture.png); width: 100px; height: 40px; font-family: PreviewTest; }");
  copyFileSync(new URL("./fixtures/fonts/inter-latin.woff2", import.meta.url), join(root, "preview.woff2"));
  writeFileSync(join(root, "icon.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="red"/></svg>');
  writeFileSync(join(root, "page.js"), "document.body.dataset.companion = 'loaded';");
  if (process.env.AXIOM_HTML_FIXTURE) {
    copyFileSync(process.env.AXIOM_HTML_FIXTURE, join(root, "connection-draft.html"));
    copyFileSync(join(dirname(process.env.AXIOM_HTML_FIXTURE), "connection-draft.css"), join(root, "connection-draft.css"));
  }
  app = await startServer({ root: join(root, "data"), port: 0, dev: true });
  const workspace = app.store.execute({ requestId: crypto.randomUUID(), op: "workspace.open", params: { path: root, authorized: true } }) as Workspace;
  const session = app.store.execute({ requestId: crypto.randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
  const scope = { workspaceId: workspace.id, sessionId: session.id };
  // This fixture injects display messages only; name it so empty-session reuse
  // does not turn the navigation assertion into a selection of the same session.
  app.store.execute({ requestId: crypto.randomUUID(), op: "session.rename", ...scope, params: { title: "文件预览回归" } });
  const views = (app.agents as unknown as { views: AgentViews }).views;
  const source = `已整理以下文件，点击即可查看：\n\n[设计说明](<${join(root, "设计说明.md").replace(/\\/g, "/")}>) · [大文本](large.txt) · [示例代码](example.ts:12) · [中文文本](legacy.txt) · [Office 文件](report.docx) · [HTML 文件](unsafe.html) · [缺失文件](missing.md) · [图片文件](picture.png) · [特殊文件名](spec%231.md) · [PDF 文件](preview.pdf) · [实际页面](connection-draft.html) · [表格文件](data.xlsx) · [演示文件](slides.pptx) · [音频文件](sound.wav) · [视频文件](movie.webm) · [压缩包文件](files.zip) · [模块网页](runtime/index.html) · [临时项目](project)`;
  views.messageChanged(scope, { id: "file-reply", role: "assistant", text: source }); views.flush(scope);
  browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.origin });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const externalRequests: string[] = [];
  await page.route("https://preview-egress.invalid/**", route => { externalRequests.push(route.request().url()); return route.abort(); });
  let hold = false, held: (() => void) | undefined;
  const requests = new Map<string, string>(); let revealRequest: any;
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    socket.onMessage(raw => {
      const c = JSON.parse(raw.toString());
      if (c.op === "files.document") requests.set(c.requestId, c.params.href);
      if (c.op === "files.reveal") { revealRequest = c; socket.send(JSON.stringify({ type: "receipt", requestId: c.requestId, ok: false, error: { code: "TEST", message: "测试：桌面暂不可用" } })); }
      else server.send(raw);
    });
    server.onMessage(raw => { const r = JSON.parse(raw.toString()); if (hold && requests.has(r.requestId)) { held = () => socket.send(raw); hold = false; } else socket.send(raw); });
  });
  await page.addInitScript(value => {
    if (window === window.top && location.protocol === "http:") sessionStorage.setItem("view", JSON.stringify(value));
  }, scope);
  await page.goto(app.origin); await page.locator('[aria-label="助手回复"]').waitFor();
  const png = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1000; c.height = 2000; const ctx = c.getContext("2d")!; ctx.fillStyle = "#18383e"; ctx.fillRect(0,0,1000,2000); ctx.fillStyle = "#c5e8dd"; ctx.font = "40px sans-serif"; ctx.fillText("Axiom · File preview", 60, 260); return c.toDataURL().split(",")[1]; });
  writeFileSync(join(root, "picture.png"), Buffer.from(png, "base64"));
  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90; const context = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" }), chunks: Blob[] = [];
    recorder.ondataavailable = e => chunks.push(e.data); const done = new Promise<void>(resolve => { recorder.onstop = () => resolve(); }); recorder.start();
    context.fillStyle = "#c5e8dd"; context.fillRect(0, 0, 160, 90); await new Promise(r => setTimeout(r, 250)); recorder.stop(); await done; stream.getTracks().forEach(t => t.stop());
    return btoa(String.fromCharCode(...new Uint8Array(await new Blob(chunks).arrayBuffer())));
  });
  writeFileSync(join(root, "movie.webm"), Buffer.from(video, "base64"));
  await page.locator("#prompt").fill("预览时继续编辑，不丢失这份草稿。");
  const open = async (name: string) => { await page.getByRole("button", { name, exact: true }).click(); await page.locator('.file-preview-body[aria-busy="false"]').waitFor(); };
  const close = async () => { await page.getByRole("button", { name: "关闭文件预览", exact: true }).click(); await page.locator(".file-preview-panel").waitFor({ state: "detached" }); };
  const geometry = async () => {
    const boxes = await page.evaluate(() => {
      const rects = [".file-preview-panel", ".thread-shell", ".composer-area"].map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, bottom:r.bottom, right:r.right }; });
      return { panel:rects[0], shell:rects[1], composer:rects[2], overflow:document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.ok(boxes.panel.x >= boxes.shell.x + boxes.shell.width * .1 - 1);
    assert.ok(boxes.panel.bottom <= boxes.composer.y + 1); assert.ok(boxes.panel.right <= boxes.shell.right + 1); assert.equal(boxes.overflow, false);
  };
  const htmlGeometry = async () => {
    const iframe = page.locator(".file-html-frame"), box = (await iframe.boundingBox())!;
    const pane = (await page.locator(".file-reading-pane").boundingBox())!;
    assert.ok(Math.abs(box.width - pane.width) < 2);
    const wrapper = (await (await iframe.elementHandle())!.contentFrame())!;
    const frame = (await (await wrapper.locator("iframe").elementHandle())!.contentFrame())!;
    await frame.waitForFunction(width => Math.abs(innerWidth - width) < 2, box.width, { timeout: 5000 });
    // A static sandbox blocks its own animation callbacks; settle layout in the host instead.
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  };
  await open("设计说明"); await page.locator(".file-reading h1").waitFor();
  assert.ok((await page.locator(".file-reading").innerText()).includes("中文 Markdown 文档"));
  assert.equal(await page.evaluate(() => (window as any).previewUnsafe), undefined);
  assert.equal(await page.locator(".file-reading .file-reference, .file-reading a").count(), 0);
  await geometry(); await page.screenshot({ path: join(artifacts, "reading-1440.png") });
  await page.getByRole("button", { name:"源码与预览对比", exact:true }).click();
  const divider = page.getByRole("separator", { name:"调整源码与预览宽度" });
  const box = (await divider.boundingBox())!; await page.mouse.move(box.x + 4, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 140, box.y + 100, { steps:10 }); await page.mouse.up();
  assert.ok(Number(await divider.getAttribute("aria-valuenow")) > 50);
  await divider.focus(); await page.keyboard.press("Home"); assert.equal(await divider.getAttribute("aria-valuenow"), "20");
  await page.keyboard.press("End"); assert.equal(await divider.getAttribute("aria-valuenow"), "80");
  await divider.dblclick(); assert.equal(await divider.getAttribute("aria-valuenow"), "50");
  await page.screenshot({ path: join(artifacts, "split-1440.png") });
  await page.getByRole("button", { name:"Markdown 源码", exact:true }).click();
  assert.ok((await page.locator(".file-source-code pre").innerText()).includes("# 文件预览"));
  await page.getByRole("button", { name:"自动换行", exact:true }).click();
  assert.equal(await page.getByRole("button", { name:"自动换行", exact:true }).getAttribute("aria-pressed"), "true");
  await page.locator(".file-path").hover();
  await page.locator(".file-title").getByRole("button", { name:"打开所在文件夹", exact:true }).click();
  await page.getByText("测试：桌面暂不可用", { exact:true }).waitFor(); assert.equal(revealRequest.sessionId, scope.sessionId); assert.equal(revealRequest.params.messageId, "file-reply"); assert.equal(revealRequest.params.path, undefined);
  await page.getByRole("button", { name:"重新加载文件", exact:true }).click(); await page.locator('.file-preview-body[aria-busy="false"]').waitFor();
  await page.locator("#prompt").fill("输入框在预览期间依然可用。");
  for (const width of [360,390,430,600,820,1024,1366,1440,1920]) {
    await page.setViewportSize({ width, height:900 });
    for (const mode of ["Markdown 源码", "源码与预览对比", "Markdown 阅读"]) { await page.getByRole("button", { name:mode, exact:true }).click(); await geometry(); }
    if ([390,820,1440].includes(width)) await page.screenshot({ path:join(artifacts, `reading-${width}.png`) });
  }
  await page.setViewportSize({ width:1440, height:1000 });
  await page.getByRole("button", { name:"关闭文件预览", exact:true }).focus(); await page.keyboard.press("Escape");
  assert.equal(await page.locator(".file-preview-panel").count(), 0);
  assert.equal(await page.getByRole("button", { name:"设计说明", exact:true }).evaluate(n => n === document.activeElement), true);
  assert.equal(await page.locator("#prompt").inputValue(), "输入框在预览期间依然可用。");
  await open("示例代码"); assert.ok(await page.locator(".file-source-scroll").evaluate(n => n.scrollTop > 100)); await close();
  await open("大文本");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑文件内容", exact: true });
  const bigText = "x".repeat(250000) + " updated";
  await editor.fill(bigText);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "detached" });
  assert.equal(readFileSync(join(root, "large.txt"), "utf8"), bigText, "250 KB save traverses client transport");
  await page.getByRole("button", { name: "编辑", exact: true }).click(); await editor.fill("my unsaved change");
  writeFileSync(join(root, "large.txt"), "external change");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.locator(".file-editor-notice").filter({ hasText: /文件已/ }).waitFor();
  assert.equal(await editor.inputValue(), "my unsaved change");
  assert.equal(readFileSync(join(root, "large.txt"), "utf8"), "external change");
  const discardDialog = page.getByRole("dialog", { name: "放弃未保存的文件编辑？", exact: true });
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await discardDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await editor.inputValue(), "my unsaved change");
  assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM sessions").get()!.n, 1, "cancelled navigation does not create a session");
  await page.getByRole("button", { name: "设计说明", exact: true }).click();
  await discardDialog.waitFor();
  await page.keyboard.press("Escape");
  await discardDialog.waitFor({ state: "detached" });
  assert.equal(await editor.inputValue(), "my unsaved change", "declining navigation retains draft");
  await page.getByRole("button", { name: "关闭文件预览", exact: true }).click();
  await discardDialog.getByRole("button", { name: "放弃修改", exact: true }).click();
  await page.locator(".file-preview-panel").waitFor({ state: "detached" });
  await open("中文文本"); assert.equal(await page.locator(".file-source-code pre").innerText(), "中文"); await close();
  await open("Office 文件"); await page.locator(".file-office article").filter({ hasText: "文档正文 & 安全阅读" }).waitFor(); await page.getByRole("cell", { name: "表格内容" }).waitFor(); await page.screenshot({ path: join(artifacts, "office-word-1440.png") }); await close();
  await open("表格文件"); await page.getByRole("cell", { name: "销售", exact: true }).waitFor(); assert.deepEqual(await page.locator(".file-office td").allTextContents(), ["销售", "", "42"]); await close();
  await open("演示文件"); await page.locator(".file-office article").filter({ hasText: "幻灯片内容" }).waitFor(); await close();
  await open("音频文件"); await page.waitForFunction(() => (document.querySelector("audio")?.readyState ?? 0) >= 1); assert.equal(await page.locator("audio").evaluate((n: HTMLAudioElement) => n.autoplay), false); assert.equal(await page.locator("audio").evaluate((n: HTMLAudioElement) => n.duration), 1); await close();
  await open("视频文件"); await page.waitForFunction(() => (document.querySelector("video")?.videoWidth ?? 0) > 0); assert.equal(await page.locator("video").evaluate((n: HTMLVideoElement) => n.autoplay), false); await close();
  await open("压缩包文件"); await page.getByRole("button", { name: "folder/note.txt", exact: true }).click(); await page.locator(".file-source-code").filter({ hasText: "压缩包成员内容" }).waitFor(); assert.equal(await page.getByRole("button", { name: "编辑", exact: true }).count(), 0); await page.getByRole("button", { name: "返回压缩包", exact: true }).click(); await page.locator(".file-archive").waitFor(); await close();
  await open("HTML 文件");
  const html = page.frameLocator(".file-html-frame").frameLocator("iframe");
  await html.getByRole("heading", { name: "HTML 页面已显示" }).waitFor();
  assert.equal(await page.locator(".file-html-frame").getAttribute("sandbox"), "");
  assert.equal(await page.frameLocator(".file-html-frame").locator("iframe").getAttribute("sandbox"), "");
  assert.equal(await html.locator("body").getAttribute("data-companion"), null, "scripts are disabled by default");
  await page.screenshot({ path: join(artifacts, "html-static-1440.png") });
  await html.locator("#local-image").evaluate((node: HTMLImageElement) => node.decode());
  assert.equal(await html.locator("body").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(235, 245, 250)", "static CSS remains visible without scripts");
  const enableScripts = async () => {
    await page.getByRole("button", { name: "启用页面脚本", exact: true }).click();
    await html.locator('body[data-companion="loaded"]').waitFor();
  };
  await enableScripts();
  assert.equal(await html.locator("body").getAttribute("data-companion"), "loaded");
  assert.equal(await html.locator("body").getAttribute("data-literal"), "<link rel='stylesheet' href='page.css'>");
  assert.equal(await html.locator("textarea").inputValue(), "<link rel='stylesheet' href='page.css'>");
  assert.equal(await html.locator("body").getAttribute("data-parent-blocked"), "true");
  assert.equal(await html.locator("body").getAttribute("data-storage-blocked"), "true");
  assert.equal(await html.locator("body").getAttribute("data-network-blocked"), "true");
  assert.equal(await html.locator("body").evaluate(node => getComputedStyle(node).backgroundColor), "rgb(235, 245, 250)");
  for (const id of ["local-image", "local-svg"]) {
    await html.locator(`#${id}`).evaluate((node: HTMLImageElement) => node.decode());
    assert.ok(await html.locator(`#${id}`).evaluate((node: HTMLImageElement) => node.naturalWidth > 0));
  }
  for (const id of ["css-background", "inline-background", "style-background"]) {
    assert.match(await html.locator(`#${id}`).evaluate(node => getComputedStyle(node).backgroundImage), /data:image\/png;base64,/);
  }
  assert.equal(await html.locator("#css-background").evaluate(async node => {
    await node.ownerDocument.fonts.load("16px PreviewTest");
    return node.ownerDocument.fonts.check("16px PreviewTest");
  }), true);
  await page.locator(".file-notice").filter({ hasText: "1 个页面资源未加载" }).waitFor();
  assert.equal(await page.evaluate(() => (window as any).previewUnsafe), undefined);
  assert.equal(await page.locator(".file-html-frame").getAttribute("sandbox"), "allow-scripts");
  await html.getByRole("button", { name: "点击 0", exact: true }).click();
  await html.getByRole("button", { name: "点击 1", exact: true }).waitFor();
  await page.getByRole("button", { name: "HTML 源码", exact: true }).click();
  assert.ok((await page.locator(".file-source-code pre").innerText()).includes('<link rel="stylesheet" href="p&#97;ge.css?a=1&amp;b=2">'));
  await page.getByRole("button", { name: "HTML 预览", exact: true }).click();
  await html.getByRole("button", { name: "点击 1", exact: true }).waitFor();
  const copy = page.getByRole("button", { name: "复制文件路径", exact: true });
  await page.locator(".file-path").hover();
  await copy.click();
  await page.locator('.file-title [role="status"]').filter({ hasText: "已复制路径" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), join(root, "unsafe.html"));
  await page.evaluate(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    let failed = false;
    navigator.clipboard.writeText = async text => { if (!failed) { failed = true; throw new Error("clipboard denied"); } await original(text); };
  });
  await copy.click();
  const retryCopy = page.getByRole("button", { name: "复制失败，点击重试", exact: true });
  await retryCopy.waitFor(); await retryCopy.focus(); await page.keyboard.press("Enter");
  await page.locator('.file-title [role="status"]').filter({ hasText: "已复制路径" }).waitFor();
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const mode of ["HTML 源码", "源码与预览对比", "HTML 预览"]) { await page.getByRole("button", { name: mode, exact: true }).click(); await geometry(); }
    await htmlGeometry();
    await page.screenshot({ path: join(artifacts, `html-${width}.png`) });
  }
  await page.getByRole("button", { name: "重新加载文件", exact: true }).click();
  await enableScripts();
  await html.getByRole("button", { name: "点击 0", exact: true }).waitFor();
  for (const method of ["script", "link", "refresh"]) {
    const wrapper = (await (await page.locator(".file-html-frame").elementHandle())!.contentFrame())!;
    const frame = (await (await wrapper.locator("iframe").elementHandle())!.contentFrame())!;
    await frame.evaluate(method => {
      const url = "https://preview-egress.invalid/blocked";
      if (method === "script") location.assign(url);
      else if (method === "link") { const link = document.createElement("a"); link.href = url; document.body.append(link); link.click(); }
      else { const meta = document.createElement("meta"); meta.httpEquiv = "refresh"; meta.content = `0; url=${url}`; document.head.append(meta); }
    }, method);
    await frame.waitForURL("chrome-error://chromewebdata/");
    assert.deepEqual(externalRequests, []);
    await page.getByRole("button", { name: "重新加载文件", exact: true }).click();
    await enableScripts();
    await html.getByRole("button", { name: "点击 0", exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "停用页面脚本", exact: true }).click();
  await html.locator('body:not([data-companion])').waitFor();
  assert.equal(await page.locator(".file-html-frame").getAttribute("sandbox"), "");
  await enableScripts();
  await close();
  await open("HTML 文件");
  await html.getByRole("heading", { name: "HTML 页面已显示" }).waitFor();
  assert.equal(await html.locator("body").getAttribute("data-companion"), null, "closing and reopening resets script permission");
  assert.equal(await page.frameLocator(".file-html-frame").locator("iframe").getAttribute("sandbox"), "");
  await page.setViewportSize({ width: 390, height: 900 });
  await htmlGeometry(); await geometry();
  await page.screenshot({ path: join(artifacts, "html-static-390.png") });
  await close();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open("模块网页"); await page.getByRole("button", { name: "网页／项目运行", exact: true }).click();
  await page.getByRole("button", { name: "确认并启动", exact: true }).waitFor();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "确认并启动", exact: true }).click();
  const running = page.frameLocator('iframe[title="独立网页运行预览"]').frameLocator("iframe");
  await running.locator('body[data-result="模块/原文11动态请求动态模块"]').waitFor(); assert.equal(await running.locator("body").getAttribute("data-isolated"), "yes");
  const runtimeUrl = await running.locator("body").evaluate(() => location.href); assert.notEqual(new URL(runtimeUrl).origin, app.origin);
  for (const width of [390, 820, 1440]) { await page.setViewportSize({ width, height: 900 }); await geometry(); await page.screenshot({ path: join(artifacts, `runtime-${width}.png`) }); }
  await page.getByRole("button", { name: "停止运行", exact: true }).click(); await page.locator('iframe[title="独立网页运行预览"]').waitFor({ state: "detached" });
  await assert.rejects(fetch(runtimeUrl)); await close(); await open("模块网页"); assert.equal(await page.locator('iframe[title="独立网页运行预览"]').count(), 0); await close();
  await open("临时项目"); await page.getByRole("button", { name: "网页／项目运行", exact: true }).click(); await page.getByRole("button", { name: "确认并启动", exact: true }).waitFor();
  page.once("dialog", dialog => dialog.accept()); await page.getByRole("button", { name: "确认并启动", exact: true }).click();
  await running.getByRole("heading", { name: "临时项目运行成功", exact: true }).waitFor(); const projectUrl = await running.locator("body").evaluate(() => location.href); await close();
  // Stop is asynchronous after unmount; observe a bounded endpoint shutdown rather than sleeping indefinitely.
  for (let i = 0; i < 30; i++) { try { await fetch(projectUrl); await page.waitForTimeout(50); } catch { break; } } await assert.rejects(fetch(projectUrl));
  if (process.env.AXIOM_HTML_FIXTURE) {
    await open("实际页面");
    await page.getByRole("button", { name: "启用页面脚本", exact: true }).click();
    const draft = page.frameLocator(".file-html-frame").frameLocator("iframe");
    await draft.locator("#device").waitFor();
    assert.deepEqual(await draft.locator(".sprite").evaluate(node => { const style = getComputedStyle(node); return [style.position, style.width, style.height]; }), ["absolute", "0px", "0px"]);
    await draft.locator("#device").click(); await draft.locator("#devices").waitFor({ state: "visible" });
    await draft.locator("#device").click();
    for (const width of [390, 1440]) { await page.setViewportSize({ width, height: 900 }); await geometry(); await htmlGeometry(); await page.screenshot({ path: join(artifacts, `connection-draft-${width}.png`) }); }
    await close();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open("特殊文件名"); await page.getByRole("heading",{name:"带井号的文件名"}).waitFor(); await close();
  await open("PDF 文件"); await page.locator('.file-pdf object[data^="blob:"]').waitFor();
  // Chromium's native PDF viewer rasterizes in its own frame after the object mounts.
  await page.waitForTimeout(2000);
  assert.ok(page.frames().some(frame => frame.url().startsWith("chrome-extension://")), "Chromium PDF reader is loaded");
  await page.screenshot({path:join(artifacts,"pdf-1440.png")}); await close();
  await open("图片文件"); await page.locator(".file-image-scroll img").evaluate((n:HTMLImageElement) => n.decode());
  await page.waitForFunction(() => { const img = document.querySelector<HTMLImageElement>(".file-image-scroll img")!; const scroll = document.querySelector(".file-image-scroll")!; return img.width > 0 && img.height <= scroll.clientHeight && img.width <= scroll.clientWidth; });
  await page.screenshot({path:join(artifacts,"image-fit-1440.png")});
  await page.getByRole("button", {name:"放大图片", exact:true}).click(); assert.equal(await page.locator(".file-zoom").innerText(), "125%");
  assert.ok(await page.locator(".file-image-scroll").evaluate(n => n.querySelector("img")!.getBoundingClientRect().left >= n.getBoundingClientRect().left));
  await page.locator(".file-image-scroll").evaluate(n => { n.scrollLeft = n.scrollWidth; n.scrollTop = n.scrollHeight; });
  assert.ok(await page.locator(".file-image-scroll").evaluate(n => { const img = n.querySelector("img")!.getBoundingClientRect(); const viewport = n.getBoundingClientRect(); return img.right <= viewport.right + 1 && img.bottom <= viewport.bottom + 1; }));
  await page.getByRole("button", {name:"图片适应窗口", exact:true}).click();
  await page.waitForFunction(() => document.querySelector(".file-image-scroll")?.scrollTop === 0); await close();
  await open("缺失文件"); await page.getByText("文件不存在或已移动", {exact:true}).waitFor();
  writeFileSync(join(root,"missing.md"), "# 恢复成功"); await page.getByRole("button", {name:"重新加载",exact:true}).click(); await page.getByRole("heading",{name:"恢复成功"}).waitFor(); await close();
  hold = true; await page.getByRole("button",{name:"设计说明",exact:true}).click(); await page.getByText("正在读取文件",{exact:true}).waitFor();
  await close(); await open("中文文本");
  assert.ok(held); held();
  await page.waitForFunction(() => document.querySelector(".file-title strong")?.textContent === "legacy.txt");
  assert.equal(await page.locator(".file-source-code pre").innerText(), "中文"); await close();
  await open("设计说明");
  await page.getByRole("button", {name:"新建会话",exact:true}).click();
  await page.locator(".file-preview-panel").waitFor({state:"detached"});
  assert.deepEqual(errors, []); assert.equal(app.store.db.prepare("SELECT count(*) AS n FROM runs").get()!.n, 0);
  console.log(`PASS file preview: real scoped reads, Markdown 3 modes, pointer/keyboard separator, encoding, code line, images, unsupported/error/retry, reveal failure, late response, session change, composer preserved, Office/AV/archive, isolated module+dynamic fetch/project execution and shutdown, 9 widths. Screenshots: ${artifacts}`);
} finally {
  await browser?.close(); await app?.close();
  if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
  rmSync(root,{recursive:true,force:true});
}
