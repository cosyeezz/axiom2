// Standalone: npm exec tsx tests/attachment-references.check.ts
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { attachmentPrompt } from "../src/shared/protocol.js";
import { chatMessage } from "../src/server/transcript.js";

const output = resolve("test-results/attachment-references");
mkdirSync(output, { recursive: true });
const attachments = [
  { id: "file1", kind: "file" as const, name: "haluo还款.txt", path: "/tmp/haluo还款.txt", text: "" },
  { id: "folder1", kind: "folder" as const, name: "资料", path: "/tmp/资料", text: "" },
  { id: "img1", kind: "image" as const, name: "截图.png", path: "/tmp/截图.png", text: "" },
];
const text = "[file1]这个是一个skill的内容，你看看\n[folder1] [img1] 未绑定[file99] `代码[file1]`";
const message = chatMessage({ role: "user", content: attachmentPrompt(text, attachments) }, "references")!;
const fixture = `
import React, {useRef} from 'react'; import {createRoot} from 'react-dom/client';
import {Icons} from '/components.tsx';
import {AttachmentInputOverlay} from '/chat/AttachmentInputOverlay.tsx';
import {EditableUserMessage} from '/chat/EditableUserMessage.tsx';
import '/styles/tokens.css'; import '/styles/workbench.css'; import '/styles/chat.css'; import '/styles/icon-geometry.css'; import '/styles/theme.css';
const draft = ${JSON.stringify({ text, attachments, images: [], attachment: null, revision: 0 })};
function App() { const input=useRef(null); return React.createElement(React.Fragment,null,React.createElement(Icons),
React.createElement('main',{style:{padding:20,maxWidth:600}},
React.createElement('div',{className:'composer',style:{position:'relative'}},React.createElement('textarea',{'aria-label':'输入消息',ref:input,value:draft.text,readOnly:true,rows:5}),React.createElement(AttachmentInputOverlay,{input,draft})),
React.createElement('article',{className:'log-row'},React.createElement(EditableUserMessage,{message:${JSON.stringify(message)},scope:{workspaceId:'fixture',sessionId:'references'}})))); }
createRoot(document.getElementById('root')).render(React.createElement(App));`;
const server = await createServer({ configFile: false, root: resolve("src/client"), cacheDir: resolve(output, "vite-cache"),
  server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "attachment-references", resolveId(id) { if (id === "/fixture.tsx") return "\0fixture.tsx"; }, load(id) { if (id === "\0fixture.tsx") return fixture; } }] });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/references", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>' }));
  await page.goto(server.resolvedUrls!.local[0] + "references");
  await page.locator(".user-text .attachment-reference").first().waitFor();
  const sent = page.locator(".user-text .markdown");
  assert.deepEqual(await sent.locator(".attachment-symbol small").allTextContents(), ["file1", "folder1", "img1"]);
  assert.deepEqual(await sent.locator(".attachment-symbol use").evaluateAll(nodes => nodes.map(node => node.getAttribute("href"))), ["#i-file-text", "#i-folder-open", "#i-image"]);
  assert.match(await sent.innerText(), /未绑定\[file99\]/);
  assert.equal(await sent.locator("code").innerText(), "代码[file1]");
  for (const theme of ["dark", "light"]) for (const width of [390, 1440]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.setViewportSize({ width, height: 700 });
    const styles = await page.locator(".attachment-reference").evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node), icon = getComputedStyle(node.querySelector("svg")!), label = getComputedStyle(node.querySelector("small")!);
      return { padding: style.padding, border: style.border, background: style.backgroundColor, color: style.color, radius: style.borderRadius, width: icon.width, height: icon.height, font: label.font };
    }));
    assert.ok(styles.length >= 6);
    for (const style of styles) assert.deepEqual(style, styles[0], "all types and both surfaces share badge geometry and colors");
    assert.equal(await page.getByRole("textbox").inputValue(), text);
    await page.screenshot({ path: resolve(output, `${theme}-${width}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log("PASS shared attachment references: file/folder/image, composer and sent message, metadata projection, unknown/code preservation, dark/light at 390/1440.");
} finally { await browser.close(); await server.close(); }
