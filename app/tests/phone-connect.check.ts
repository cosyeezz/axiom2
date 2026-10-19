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
const qr = page.getByRole("img",{name:"连接二维码"}), section = page.getByRole("region",{name:"手机连接"});
const fixtures: Array<{file:string;url:string}> = [];
async function refresh() { await page.getByRole("button",{name:"刷新地址",exact:true}).click(); }
async function image(name: string, url: string) { const file = join(output,name); await qr.screenshot({path:file});fixtures.push({file,url}); }
try {
  await page.goto(`http://127.0.0.1:${port}/settings.html`);
  await qr.waitFor();
  assert.ok(requests > 0,"Settings automatically reads the local address");
  assert.equal(await page.getByRole("dialog").count(),0,"QR is inline, without a dialog");
  assert.equal(await section.locator("input").count(),0,"No manual address input");
  assert.equal(await page.locator(".phone-connect-code code").textContent(),v4,"IPv4 is preferred");
  assert.equal(await qr.evaluate(node => getComputedStyle(node).stroke),"none","Global icon stroke must not contaminate QR");
  await image("qr-ipv4.png",v4); await page.screenshot({path:join(output,"desktop.png")});
  const addressPicker = page.getByRole("combobox", {name:"选择连接地址"});
  await addressPicker.click();
  const menu = page.getByRole("listbox", {name:"连接地址"});
  await menu.waitFor();
  assert.equal(await section.locator("select").count(),0,"Address menu uses the application UI");
  assert.equal(await menu.getByRole("option",{selected:true}).count(),1);
  await page.screenshot({path:join(output,"desktop-menu.png")});
  await addressPicker.press("Escape");assert.equal(await menu.count(),0);
  assert.ok(await addressPicker.evaluate(node=>node===document.activeElement));
  await addressPicker.press("ArrowDown");await addressPicker.press("End");await addressPicker.press("Enter");
  assert.equal(await page.locator(".phone-connect-code code").textContent(),v6);
  await addressPicker.press("Home");await addressPicker.press("Enter");
  assert.equal(await page.locator(".phone-connect-code code").textContent(),v4);
  await addressPicker.click();await page.getByRole("heading",{name:"扫码连接这台电脑"}).click();assert.equal(await menu.count(),0);
  await addressPicker.click();await addressPicker.press("Tab");assert.equal(await menu.count(),0);
  await addressPicker.click();await addressPicker.press("End");
  urls=[v6,v4,"http://100.64.0.3:4317/"];
  await page.waitForFunction(() => document.querySelectorAll('.phone-address-option').length===3);
  assert.ok(await addressPicker.evaluate(node=>node===document.activeElement),"Polling keeps trigger focus");
  assert.ok(await addressPicker.evaluate(node=>document.getElementById(node.getAttribute('aria-activedescendant')!)?.textContent?.includes('IPv6')),"Polling preserves active address identity");
  urls=[v4];await addressPicker.waitFor({state:"detached"});
  assert.ok(await page.getByRole("button",{name:"刷新地址",exact:true}).evaluate(node=>node===document.activeElement),"Removed picker restores focus to refresh");
  urls=[v6,v4];await refresh();await addressPicker.waitFor();
  await page.evaluate('Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:() => new Promise(resolve => { window.finishCopy = resolve; })}})');
  await page.getByRole("button",{name:"复制地址",exact:true}).click();
  await addressPicker.click();await menu.getByRole("option").filter({hasText:"IPv6"}).click();
  await page.evaluate(() => (window as any).finishCopy());
  assert.equal(await page.locator(".phone-connect-code [role=status]").textContent(),"","Late copy cannot label a different address copied");
  await image("qr-ipv6.png",v6);
  for (const [width,height] of [[320,640],[390,844],[844,390]]) {
    await page.setViewportSize({width,height});
    assert.ok(await section.evaluate(node => node.scrollWidth <= node.clientWidth + 1),"Section horizontal overflow");
    await page.screenshot({path:join(output,`${width}x${height}.png`)});
    await addressPicker.click();await menu.waitFor();
    const bounds=await menu.boundingBox();assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x+bounds.width <= width+1 && bounds.y+bounds.height <= height+1,"Menu stays in viewport");
    assert.ok(await menu.evaluate(node=>node.scrollWidth<=node.clientWidth+1),"Menu content does not overflow");
    await page.screenshot({path:join(output,`${width}x${height}-menu.png`)});
    await addressPicker.press("Escape");
  }
  urls=[]; message="等待 Tailscale 网络，连接后会自动就绪。"; await refresh(); await page.getByText(message,{exact:true}).waitFor(); assert.equal(await qr.count(),0);
  code=403;await refresh();await page.getByRole("alert").filter({hasText:"请在电脑本机"}).waitFor();assert.equal(await qr.count(),0);
  code=503;await refresh();await page.getByRole("alert").filter({hasText:"暂不可用"}).waitFor();
  code=200;urls=["http://evil.example:4317/"];await refresh();await page.getByRole("alert").filter({hasText:"响应无效"}).waitFor();assert.equal(await qr.count(),0);
  urls=[v4];oversized=true;await refresh();await page.getByRole("alert").filter({hasText:"响应过大"}).waitFor();oversized=false;
  error="x".repeat(500);urls=[];await refresh();await section.getByRole("status").filter({hasText:error}).waitFor();assert.ok(await section.evaluate(node=>node.scrollWidth <= node.clientWidth+1));error="";
  urls=[v6];await refresh();await qr.waitFor();await image("qr-ipv6-only.png",v6);
  // A superseded request must never replace the latest automatically read address.
  hold=true;urls=[v4];const before=requests;await refresh();await page.waitForFunction(() => true);
  while(requests===before) await page.waitForTimeout(25);
  hold=false;urls=[v6];await refresh();await qr.waitFor();releases.splice(0).forEach(release=>release());await page.waitForTimeout(100);
  assert.equal(await page.locator(".phone-connect-code code").textContent(),v6);
  // Timeout clears the old QR and the next automatic request can recover.
  hold=true;await refresh();await page.getByRole("alert").filter({hasText:"超时"}).waitFor({timeout:12000});assert.equal(await qr.count(),0);
  hold=false;urls=[v4];releases.splice(0).forEach(release=>release());await qr.waitFor({timeout:10000});assert.equal(await page.locator(".phone-connect-code code").textContent(),v4);
  await page.keyboard.press("Escape");assert.ok(await qr.isVisible(),"Escape does not close the inline QR");
  hold=true;const beforeLeave=requests;await refresh();
  while(requests===beforeLeave) await page.waitForTimeout(25);
  await page.goto(`http://127.0.0.1:${port}/model-config.html`);
  hold=false;releases.splice(0).forEach(release=>release());await page.waitForTimeout(100);
  assert.equal(await qr.count(),0,"Leaving settings removes the QR");
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  writeFileSync(join(output,"qr-images.json"),JSON.stringify(fixtures,null,2));
  writeFileSync(join(output,"result.json"),JSON.stringify({passed:true,requests,fixtures,checks:["strict addresses","IPv4 preference","IPv6 only","rendered QR without global stroke","copy race","3 responsive sizes","empty Tailnet","403","503","unsafe URL","bounded response","long message wrapping","inline auto generation without input or dialog","custom menu styling","menu keyboard and dismissal","menu viewport bounds","polling preserves menu focus and active address","removed picker restores focus","late response after refresh","timeout recovery","Escape retains inline content","leave settings cleanup","no external requests"]},null,2));
  console.log(JSON.stringify({passed:true,output,requests}));
} finally { releases.splice(0).forEach(release=>release());await browser.close();await server.close(); }
