import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createServer } from "vite";
import { chromium } from "playwright";
import { connectionAddress } from "../src/client/settings/connection-qr.js";

const output = resolve(process.env.AXIOM_QR_OUTPUT || "../artifacts/qr-connect/browser"); mkdirSync(output, { recursive: true });
const v4 = "http://100.64.0.2:4317/", v6 = "http://[fd7a:115c:a1e0::2]:4317/";
for (const good of [v4,v6,"http://100.127.255.255:65535/","http://100.64.0.0:1/","http://100.64.0.2:80/"]) assert.equal(connectionAddress(good),good);
for (const bad of ["http://localhost:4317", "http://100.63.0.1:4317", "http://100.128.0.1:4317", "http://100.064.0.1:4317", "http://100.64.0.256:4317", "http://100.64.0.2", "https://100.64.0.2:4317", v4+"?secret=1", v4+"#x", v4+"settings", v4+"\n", "http://user@100.64.0.2:4317", "http://[fd7a:115c:a1e1::2]:4317", "http://[fd7a:115c:a1e0::2%25wlan0]:4317", "http://100.64.0.2:65536", "http://100.64.0.2:0", "http://100.64.0.2:04317"]) assert.equal(connectionAddress(bad),null,bad);
const server = await createServer({ configFile: resolve("vite.config.ts"), server: { host: "127.0.0.1", port: 0, hmr: false } }); await server.listen();
const port = (server.httpServer!.address() as {port:number}).port;
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
const page = await browser.newPage({ viewport: {width:1280,height:900} });
let urls = [v6,v4], code = 200, message = "", error = "", oversized = false, hold = false, requests = 0;
const releases: Array<() => void> = [], errors: string[] = [], external: string[] = [];
page.on("pageerror", e => errors.push(e.message));
page.on("request", request => { if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url()); });
await page.route("**/api/remote", async route => {
  requests++;
  const body = JSON.stringify({urls:[...urls],message,error,...(oversized ? {padding:"x".repeat(20000)} : {})}), status = code;
  if (hold) await new Promise<void>(resolve => releases.push(resolve));
  try { await route.fulfill({status,contentType:"application/json",body}); } catch { /* Aborted request. */ }
});
const qr = page.getByRole("img",{name:"连接二维码"}), dialog = page.getByRole("dialog",{name:"手机连接"});
const fixtures: Array<{file:string;url:string}> = [];
async function refresh() { await page.getByRole("button",{name:"刷新地址",exact:true}).click(); }
async function image(name: string, url: string) { const file = join(output,name); await qr.screenshot({path:file});fixtures.push({file,url}); }
try {
  await page.goto(`http://127.0.0.1:${port}/settings.html`);
  assert.equal(requests,0,"Collapsed entry does not poll");
  await page.getByRole("button",{name:/手机连接/}).click(); await qr.waitFor();
  assert.equal(await page.locator(".phone-connect-code code").textContent(),v4,"IPv4 is preferred");
  assert.equal(await qr.evaluate(node => getComputedStyle(node).stroke),"none","Global icon stroke must not contaminate QR");
  await image("qr-ipv4.png",v4); await page.screenshot({path:join(output,"desktop.png")});
  await page.evaluate(() => { Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:() => new Promise<void>(resolve => { (window as any).finishCopy = resolve; })}}); });
  await page.getByRole("button",{name:"复制地址",exact:true}).click();
  await page.getByLabel("选择连接地址").selectOption(v6);
  await page.evaluate(() => (window as any).finishCopy());
  assert.equal(await page.locator(".phone-connect-code [role=status]").textContent(),"","Late copy cannot label a different address copied");
  await image("qr-ipv6.png",v6);
  for (const [width,height] of [[320,640],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});
    assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1),"Dialog horizontal overflow");
    await page.screenshot({path:join(output,`${width}x${height}.png`)});
  }
  urls=[]; message="等待 Tailscale 网络，连接后会自动就绪。"; await refresh(); await page.getByText(message,{exact:true}).waitFor(); assert.equal(await qr.count(),0);
  code=403;await refresh();await page.getByRole("alert").filter({hasText:"请在电脑本机"}).waitFor();assert.equal(await qr.count(),0);
  code=503;await refresh();await page.getByRole("alert").filter({hasText:"暂不可用"}).waitFor();
  code=200;urls=["http://evil.example:4317/"];await refresh();await page.getByRole("alert").filter({hasText:"响应无效"}).waitFor();assert.equal(await qr.count(),0);
  urls=[v4];oversized=true;await refresh();await page.getByRole("alert").filter({hasText:"响应过大"}).waitFor();oversized=false;
  error="x".repeat(500);urls=[];await refresh();await dialog.getByRole("status").filter({hasText:error}).waitFor();assert.ok(await dialog.evaluate(node=>node.scrollWidth <= node.clientWidth+1));error="";
  urls=[v6];await refresh();await qr.waitFor();await image("qr-ipv6-only.png",v6);
  // A request from a closed dialog must never replace the newly opened dialog's address.
  hold=true;urls=[v4];const before=requests;await refresh();await page.waitForFunction(() => true);
  while(requests===before) await page.waitForTimeout(25);
  await page.getByRole("button",{name:"关闭",exact:true}).click();
  hold=false;urls=[v6];await page.getByRole("button",{name:/手机连接/}).click();await qr.waitFor();releases.splice(0).forEach(release=>release());await page.waitForTimeout(100);
  assert.equal(await page.locator(".phone-connect-code code").textContent(),v6);
  // Timeout clears the old QR and the next automatic request can recover.
  hold=true;await refresh();await page.getByRole("alert").filter({hasText:"超时"}).waitFor({timeout:12000});assert.equal(await qr.count(),0);
  hold=false;urls=[v4];releases.splice(0).forEach(release=>release());await qr.waitFor({timeout:10000});assert.equal(await page.locator(".phone-connect-code code").textContent(),v4);
  await page.keyboard.press("Escape");await dialog.waitFor({state:"detached"});assert.ok(await page.getByRole("button",{name:/手机连接/}).evaluate(node=>node===document.activeElement));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  writeFileSync(join(output,"qr-images.json"),JSON.stringify(fixtures,null,2));
  writeFileSync(join(output,"result.json"),JSON.stringify({passed:true,requests,fixtures,checks:["strict addresses","IPv4 preference","IPv6 only","rendered QR without global stroke","copy race","3 responsive sizes","empty Tailnet","403","503","unsafe URL","bounded response","long message wrapping","late response after close","timeout recovery","Escape focus","no external requests"]},null,2));
  console.log(JSON.stringify({passed:true,output,requests}));
} finally { releases.splice(0).forEach(release=>release());await browser.close();await server.close(); }
