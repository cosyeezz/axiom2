import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { assertSelectPosition } from "./select-helpers.js";

const root = mkdtempSync(join(tmpdir(), "axiom-select-"));
const appRoot = resolve("."), artifacts = process.env.AXIOM_SELECT_ARTIFACTS ?? "/tmp/axiom-select-review";
mkdirSync(artifacts, { recursive: true });
writeFileSync(join(root, "index.html"), `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
:root { --surface:#171918; --fg:#eee; --fg-2:#ddd; --muted:#999; --accent:#fcbc7c; --accent-hover:#fcbc7c; --border:#444; --radius-sm:6px; --elev-raised:0 8px 28px #0008; --font-body:system-ui; }
body { margin:0; background:#0c0e0d; color:var(--fg); font-family:system-ui; } .fixture { position:fixed; left:20px; right:20px; top:60px; max-width:300px; } .input { width:100%; min-height:44px; padding:8px 10px; background:var(--surface); border:1px solid var(--border); border-radius:6px; color:var(--fg); font-size:14px; } dialog { background:var(--surface); color:var(--fg); border:1px solid var(--border); padding:20px; width:min(320px,calc(100vw - 80px)); } #outside { position:fixed; right:20px; top:8px; }
</style></head><body><div id="root"></div><script type="module">
import React, {useState,useRef,useEffect} from 'react'; import {createRoot} from 'react-dom/client'; import {Select} from '/@fs/${appRoot}/src/client/Select.tsx';
const h=React.createElement; const options=Array.from({length:40},(_,i)=>({value:String(i),label:i===39?'Zulu-'+ 'long-project-name-'.repeat(12):'Project '+String(i).padStart(2,'0'),group:i?'项目':undefined}));
function Fixture(){ const [value,setValue]=useState('20'),[disabled,setDisabled]=useState(false),[modal,setModal]=useState(false); const dialog=useRef(null); useEffect(()=>{if(modal)dialog.current.showModal()},[modal]); window.fixture={disable:setDisabled,modal:setModal}; const select=h(Select,{id:'fixture-select',label:'作用范围',value,options,onChange:setValue,disabled}); return h(React.Fragment,null,h('div',{className:'fixture'},h('label',{htmlFor:'fixture-select'},'作用范围'),!modal&&select,h('output',{id:'value'},value)),h('button',{id:'outside',onClick:()=>{}},'外部按钮'),modal&&h('dialog',{ref:dialog,onCancel:()=>setModal(false)},h('h2',null,'认证选项'),select,h('button',{id:'modal-next'},'下一项'))); } createRoot(document.getElementById('root')).render(h(Fixture));
</script></body></html>`);
const server = await createServer({ configFile: false, root, resolve: { alias: { react: join(appRoot, "node_modules/react"), "react-dom": join(appRoot, "node_modules/react-dom") } }, esbuild: { jsx: "automatic" }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root, appRoot] } } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.AXIOM_TEST_BROWSER });
try {
  const page = await browser.newPage({ viewport: { width:1440, height:900 } });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(server.resolvedUrls!.local[0]);
  const trigger = page.getByRole("combobox", { name:"作用范围", exact:true });
  for (const [width,height] of [[320,640],[390,844],[820,1180],[1440,900],[1024,400]]) {
    await page.setViewportSize({width,height});
    for (const placement of ["top","bottom"]) {
      await page.locator(".fixture").evaluate((node, placement) => { const el=node as HTMLElement; el.style.top=placement==="top"?"60px":"auto"; el.style.bottom=placement==="bottom"?"20px":"auto"; }, placement);
      await trigger.click(); await assertSelectPosition(page,trigger);
      const selected=page.getByRole("option",{selected:true});
      assert.ok(await selected.evaluate(node=>{const r=node.getBoundingClientRect(),p=node.closest('[role="listbox"]')!.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;}),"selected item scrolled within menu");
      await page.keyboard.press("End"); await assertSelectPosition(page,trigger);
      await page.screenshot({path:join(artifacts,`select-${placement}-${width}.png`)});
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#value").innerText(),"20","Escape does not commit active option");
      assert.ok(await trigger.evaluate(node=>node===document.activeElement));
    }
  }
  await trigger.click(); await page.keyboard.press("z"); await page.keyboard.press("Enter");
  assert.equal(await page.locator("#value").innerText(),"39","typeahead selects by label");
  await trigger.click(); await page.keyboard.press("Home"); await page.keyboard.press("Enter");
  assert.equal(await page.locator("#value").innerText(),"0");
  await trigger.click(); await page.keyboard.press("Tab"); assert.equal(await page.getByRole("listbox").count(),0);
  await trigger.click(); await page.locator("#outside").click(); assert.equal(await page.getByRole("listbox").count(),0);
  await trigger.click(); await page.evaluate(()=>window.dispatchEvent(new Event("blur"))); await page.getByRole("listbox").waitFor({state:"detached"});
  await trigger.click(); await page.evaluate(()=>window.dispatchEvent(new Event("scroll"))); await assertSelectPosition(page,trigger);
  await page.keyboard.press("Escape");
  await page.evaluate(()=>{ document.body.style.height="1800px"; Object.assign((document.querySelector(".fixture") as HTMLElement).style,{position:"absolute",top:"60px",bottom:"auto"}); });
  await trigger.click();
  await page.evaluate(()=>window.scrollTo(0,20)); await assertSelectPosition(page,trigger);
  await page.evaluate(()=>window.scrollTo(0,500)); await page.getByRole("listbox").waitFor({state:"detached"});
  await page.evaluate(()=>{ window.scrollTo(0,0); document.body.style.height=""; Object.assign((document.querySelector(".fixture") as HTMLElement).style,{position:"fixed",top:"200px",height:"120px",overflow:"auto"}); Object.assign(document.querySelector<HTMLElement>("#value")!.style,{display:"block",height:"600px"}); });
  await trigger.click();
  await page.locator(".fixture").evaluate(node=>{node.scrollTop=120;}); await page.getByRole("listbox").waitFor({state:"detached"});
  await page.evaluate(()=>{ Object.assign((document.querySelector(".fixture") as HTMLElement).style,{top:"60px",height:"",overflow:""}); document.querySelector<HTMLElement>("#value")!.removeAttribute("style"); });
  await trigger.click(); await page.evaluate(()=> (window as any).fixture.disable(true)); await page.getByRole("listbox").waitFor({state:"detached"}); assert.ok(await trigger.isDisabled());
  await page.evaluate(()=> (window as any).fixture.disable(false));
  await page.evaluate(()=> (window as any).fixture.modal(true));
  await page.getByRole("dialog").waitFor(); await trigger.click(); await assertSelectPosition(page,trigger);
  assert.ok(await page.getByRole("listbox").evaluate(node=>!!node.closest("dialog")),"menu belongs to modal");
  await page.getByRole("option",{name:"Project 01",exact:true}).click(); assert.equal(await page.locator("#value").innerText(),"1");
  await trigger.click(); await page.keyboard.press("Escape"); assert.equal(await page.getByRole("dialog").count(),1,"Escape closes options before modal");
  await trigger.click(); await page.keyboard.press("Tab"); assert.ok(await page.locator("#modal-next").evaluate(node=>node===document.activeElement));
  const touch = await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const touchPage = await touch.newPage(); await touchPage.goto(server.resolvedUrls!.local[0]);
  await touchPage.getByRole("combobox").tap(); await touchPage.getByRole("option",{name:"Project 21",exact:true}).tap();
  assert.equal(await touchPage.locator("#value").innerText(),"21","touch commits selection");
  await touch.close(); assert.deepEqual(errors,[]);
  console.log(`PASS select: top/bottom placement at five sizes, long labels, selected scroll, keyboard/typeahead, outside/Tab/blur dismissal, scroll anchoring and clipped-trigger dismissal, disabled, modal ownership and touch. Screenshots: ${artifacts}`);
} finally { await browser.close(); await server.close(); rmSync(root,{recursive:true,force:true}); }
