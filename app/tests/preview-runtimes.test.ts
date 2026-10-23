import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync, linkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "./temporary.js";
import { PreviewRuntimes } from "../src/server/preview-runtimes.js";
import { readPreviewFile } from "../src/server/preview-files.js";
import { rewritePreview } from "../src/server/preview-rewrite.js";
import type { Command } from "../src/shared/protocol.js";
import type { WebPreviewDescription, WebPreviewState } from "../src/shared/web-preview.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-preview-runtime-")); let allowed = true;
  writeFileSync(join(root, "index.html"), '<h1>preview</h1><script type="module">import "/main.js";</script>');
  writeFileSync(join(root, "main.js"), 'export const value = "module";');
  const service = new PreviewRuntimes(async c => ({ path: join(root, c.params!.href as string), name: c.params!.href as string, size: 10, modified: "fixture", revision: "revision", kind: "code" }), () => { if (!allowed) throw Error("revoked"); }, () => []);
  const cmd = (op: string, params = {}): Command => ({ requestId: randomUUID(), workspaceId: "work", sessionId: "session", op, params: { messageId: "reply", href: "index.html", ...params } });
  return { root, service, cmd, revoke: () => { allowed = false; }, close: async () => { await service.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("isolated page origins enforce capability, authorization, bounded concurrent reads and stop", async () => {
  const f = fixture();
  try {
    const description = await f.service.command(f.cmd("preview.describe")) as WebPreviewDescription;
    await assert.rejects(f.service.command(f.cmd("preview.start", { mode: "page", network: false, revision: description.revision })), { code: "CONFIRMATION_REQUIRED" });
    await assert.rejects(f.service.command(f.cmd("preview.start", { confirm: true, mode: "page", network: false, revision: "stale" })), { code: "REVISION_CONFLICT" });
    const state = await f.service.command(f.cmd("preview.start", { confirm: true, mode: "page", network: false, revision: description.revision })) as WebPreviewState;
    const url = state.urls[0], base = new URL(".", url).href, origin = new URL(url).origin;
    const html = await fetch(url); assert.equal(html.status, 200); assert.match(html.headers.get("content-security-policy")!, /sandbox allow-scripts/); assert.doesNotMatch(html.headers.get("content-security-policy")!, /allow-same-origin|connect-src[^;]*https:/);
    assert.match(await html.text(), new RegExp(`/${state.id}/main.js`));
    assert.equal((await fetch(origin + "/main.js")).status, 403);
    for (const name of [".hidden.txt", "%2e%2e/outside.txt", "data.db", "folder%2f..%2findex.html"]) assert.equal((await fetch(base + name)).status, 403);
    writeFileSync(join(f.root, "data.json"), '{"ok":true}');
    assert.ok((await Promise.all(Array.from({ length: 24 }, () => fetch(base + "data.json").then(r => r.status)))).every(status => status === 200));
    await assert.rejects(f.service.command({ ...f.cmd("preview.status", { id: state.id }), sessionId: "other" }), { code: "PREVIEW_EXPIRED" });
    f.revoke(); assert.equal((await fetch(url)).status, 403);
    await f.service.command(f.cmd("preview.stop", { id: state.id })); await assert.rejects(fetch(url));
  } finally { await f.close(); }
});

test("resource reads reject hidden, escaped and linked paths", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "assets")); writeFileSync(join(f.root, ".secret.txt"), "secret");
    assert.match((await readPreviewFile(f.root, "assets/../main.js", AbortSignal.timeout(5000))).toString(), /module/);
    symlinkSync(join(f.root, "index.html"), join(f.root, "link.html")); linkSync(join(f.root, "index.html"), join(f.root, "hard.html"));
    for (const name of ["../outside.txt", ".secret.txt", "link.html", "hard.html"]) await assert.rejects(readPreviewFile(f.root, name, AbortSignal.timeout(5000)));
  } finally { await f.close(); }
});

test("URL rewriting preserves business strings and tagged templates, handles inline imports and CSS quotes", () => {
  const js = 'const route = "/users"; const value = String.raw`/foo`; import x from "/main.js"; export * from "/other.js"; import("/" + name);';
  const rewritten = rewritePreview(js, "text/javascript", "/token/", "http://localhost/token/");
  assert.match(rewritten, /String.raw`\/foo`/); assert.match(rewritten, /const route = "\/users"/); assert.match(rewritten, /from "\/token\/main.js"/); assert.match(rewritten, /u.slice\(1\)/);
  const html = rewritePreview('<div style="background:url(&quot;/a.png&quot;)"></div><script type="module">import "/main.js"</script><script type="importmap">{"imports":{"demo":"/lib.js"}}</script><audio src="/a.wav"></audio>', "text/html", "/token/", "http://localhost/token/");
  assert.match(html, /url\(&quot;\/token\/a.png&quot;\)/); assert.match(html, /import "\/token\/main.js"/); assert.match(html, /"demo":"\/token\/lib.js"/); assert.match(html, /src="\/token\/a.wav"/); assert.match(html, /window.fetch=function/);
});

test("large development modules are served and rewritten within an 8 MiB UTF-8 parsing budget", async () => {
  const f = fixture();
  try {
    const js = 'import "/main.js";\n//# sourceMappingURL=data:application/json;base64,' + "A".repeat(3 * 1024 * 1024);
    writeFileSync(join(f.root, "development.js"), js);
    writeFileSync(join(f.root, "oversized.js"), " ".repeat(8 * 1024 * 1024 + 1));
    const description = await f.service.command(f.cmd("preview.describe")) as WebPreviewDescription;
    const state = await f.service.command(f.cmd("preview.start", { confirm: true, mode: "page", network: false, revision: description.revision })) as WebPreviewState;
    const response = await fetch(new URL("development.js", state.urls[0]));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), js.replace('"/main.js"', `"/${state.id}/main.js"`));
    const oversized = await fetch(new URL("oversized.js", state.urls[0]));
    assert.equal(oversized.status, 403); assert.match(await oversized.text(), /8 MiB/);
    const boundary = "//" + "A".repeat(8 * 1024 * 1024 - 2);
    assert.equal(rewritePreview(boundary, "text/javascript", "/token/", "http://localhost/token/"), boundary);
    // A small character count is not enough: the limit measures UTF-8 bytes.
    assert.throws(() => rewritePreview("//" + "界".repeat(3 * 1024 * 1024), "text/javascript", "/token/", "http://localhost/token/"), /8 MiB/);
  } finally { await f.close(); }
});

test("explicit project launch suppresses hooks, proxies methods/relative redirects and reaps process group", { timeout: 20000 }, async () => {
  const f = fixture(); let pid = 0, childPid = 0;
  try {
    const script = `"${process.execPath}" fixture.cjs`;
    writeFileSync(join(f.root, "package.json"), JSON.stringify({ scripts: { dev: script, predev: `${script} hook`, postdev: `${script} hook` } }));
    writeFileSync(join(f.root, "fixture.cjs"), `const fs=require('node:fs'),http=require('node:http'),{spawn}=require('node:child_process'); if(process.argv[2]){fs.writeFileSync('hook-ran','yes');process.exit()} const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('pids.json',JSON.stringify([process.pid,child.pid]));http.createServer((req,res)=>{if(req.url==='/a/b'){res.writeHead(302,{Location:'login'});res.end();return}if(req.url==='/external'){res.writeHead(302,{Location:'https://example.invalid/'});res.end();return}let body='';req.on('data',c=>body+=c);req.on('end',()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({url:req.url,method:req.method,body,auth:req.headers.authorization,cookie:req.headers.cookie,secret:process.env.AXIOM_PREVIEW_TEST_SECRET}))})}).listen(Number(process.env.PORT),process.env.HOST);`);
    process.env.AXIOM_PREVIEW_TEST_SECRET = "must-not-leak";
    const description = await f.service.command(f.cmd("preview.describe")) as WebPreviewDescription;
    const state = await f.service.command(f.cmd("preview.start", { confirm: true, mode: "project", script: "dev", network: false, revision: description.revision })) as WebPreviewState;
    [pid, childPid] = JSON.parse(readFileSync(join(f.root, "pids.json"), "utf8"));
    const url = state.urls[0]; const response = await fetch(url + "api", { method: "POST", headers: { Cookie: "secret", Authorization: "secret", "Content-Type": "application/json" }, body: '{"ok":true}' });
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { url: "/api", method: "POST", body: '{"ok":true}' });
    const redirect = await fetch(url + "a/b", { redirect: "manual" }); assert.equal(redirect.status, 302); assert.equal(redirect.headers.get("location"), new URL(url).pathname + "a/login");
    assert.equal((await fetch(url + "external", { redirect: "manual" })).status, 403);
    await f.service.command(f.cmd("preview.stop", { id: state.id }));
    assert.equal(existsSync(join(f.root, "hook-ran")), false);
    if (process.platform !== "win32") { for (let i = 0; i < 30; i++) { try { process.kill(childPid, 0); await delay(20); } catch { break; } } for (const id of [pid, childPid]) assert.throws(() => process.kill(id, 0), { code: "ESRCH" }); }
  } finally { delete process.env.AXIOM_PREVIEW_TEST_SECRET; await f.close(); }
});

test("shutdown cancels a starting project and rejects further commands", { timeout: 15000 }, async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, "package.json"), JSON.stringify({ scripts: { dev: `"${process.execPath}" -e "setInterval(()=>{},1000)"` } }));
    const description = await f.service.command(f.cmd("preview.describe")) as WebPreviewDescription;
    const pending = f.service.command(f.cmd("preview.start", { confirm: true, mode: "project", script: "dev", network: false, revision: description.revision }));
    const rejected = assert.rejects(pending); await delay(50); await f.service.close(); await rejected;
    await assert.rejects(f.service.command(f.cmd("preview.describe")), { code: "PREVIEW_CLOSED" });
  } finally { await f.close(); }
});
