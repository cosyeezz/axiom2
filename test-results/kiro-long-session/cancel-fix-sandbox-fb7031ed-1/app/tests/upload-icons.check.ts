import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium, type WebSocketRoute } from 'playwright';
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {Icons} from '/components.tsx';import {remoteFileDialog} from '/mobile/remote-files.ts';import {connect,command} from '/transport.ts';import '/styles/tokens.css';import '/styles/workbench.css';import '/styles/icon-geometry.css';
createRoot(document.getElementById('root')).render(React.createElement(Icons));
window.ready=()=>command('ping').then(()=>true,()=>false);window.openPicker=()=>{window.result=null;remoteFileDialog({purpose:'attachment',kind:'mixed',multiple:true,scope:{workspaceId:'fixture',sessionId:'upload'}},new AbortController().signal).then(r=>window.result=r);};document.getElementById('open').onclick=window.openPicker;connect();`;
const output=resolve('test-results/upload-icons');mkdirSync(output,{recursive:true});
const server=await createServer({configFile:false,root:resolve('src/client'),cacheDir:resolve(output,'vite-cache'),plugins:[{name:'upload-fixture',resolveId(id){if(id==='virtual:upload-icons')return id;},load(id){if(id==='virtual:upload-icons')return fixture;}}],server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.AXIOM_TEST_BROWSER});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 let uploads=0, hold=false, pending:{socket:WebSocketRoute;id:string;name:string}|undefined;
 await page.routeWebSocket('**/ws',socket=>socket.onMessage(raw=>{const c=JSON.parse(String(raw));if(c.op==='files.upload'){uploads++;if(hold){pending={socket,id:c.requestId,name:c.params.name};return;}socket.send(JSON.stringify({type:'receipt',requestId:c.requestId,ok:true,data:{name:c.params.name,path:'C:/fixture/'+c.params.name,kind:'file'}}));hold=true;}else socket.send(JSON.stringify({type:'receipt',requestId:c.requestId,ok:true,data:{}}));}));
 await page.route('**/api/status',r=>r.fulfill({json:{ready:true}}));await page.route('**/api/files/browse?**',r=>r.fulfill({json:{path:'C:/fixture',parent:'C:/',total:0,offset:0,entries:[]}}));
 await page.route('**/upload-check',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><button id="open">选择手机文件</button><script type="module" src="/@id/virtual:upload-icons"></script></body></html>'}));
 await page.goto(server.resolvedUrls!.local[0]+'upload-check');await page.waitForFunction(async()=>typeof(window as any).ready==='function'&&await(window as any).ready());
 const open=async()=>{await page.locator('#open').click();await page.locator('.remote-file-dialog').waitFor();await page.locator('.remote-file-dialog nav span').getByText('0 项',{exact:true}).waitFor();};
 const files=[{name:'one.txt',mimeType:'text/plain',buffer:Buffer.from('one')},{name:'two.txt',mimeType:'text/plain',buffer:Buffer.from('two')}];
 await open();await page.locator('input[type=file]').setInputFiles(files);await page.waitForFunction(()=>document.querySelector('.remote-file-status')?.textContent?.includes('已确认 1/2'));
 assert.equal(uploads,2);assert.equal(await page.locator('.upload-progress-icon rect').last().getAttribute('width'),'14');assert.equal(await page.locator('.remote-file-dialog nav').evaluate(n=>(n as HTMLElement).inert),true);
 await page.screenshot({path:resolve(output,'waiting-confirmation.png')});
 pending!.socket.send(JSON.stringify({type:'receipt',requestId:pending!.id,ok:false,error:{code:'UNCERTAIN',message:'测试回执不确定'}}));
 await page.getByText(/结果待核实，请勿重复上传/).waitFor();assert.match(await page.locator('.remote-file-status').innerText(),/已确认 1\/2.*已确认文件仍保留/);assert.equal(await page.locator('.upload-progress-icon animate').count(),0);assert.equal(uploads,2);
 await page.screenshot({path:resolve(output,'partial-uncertain.png')});await page.getByRole('button',{name:'关闭选择',exact:true}).click();
 await open();await page.locator('input[type=file]').setInputFiles(files[0]);await page.getByText(/等待 one.txt 的上传回执/).waitFor();
 pending!.socket.send(JSON.stringify({type:'receipt',requestId:pending!.id,ok:false,error:{code:'INVALID_FILE',message:'确定的上传失败'}}));
 await page.getByText(/确定的上传失败/).waitFor();assert.equal(await page.locator('.upload-progress-icon').getAttribute('data-state'),'failed');assert.equal(await page.locator('.upload-progress-icon use[href="#i-triangle-alert"]').count(),1);assert.equal(await page.locator('.upload-progress-icon text,.upload-progress-icon animate').count(),0);await page.getByRole('button',{name:'关闭选择',exact:true}).click();
 // Closing while FileReader is pending must not send a later upload.
 await page.evaluate(()=>{const original=FileReader.prototype.readAsDataURL;(window as any).restoreReader=()=>FileReader.prototype.readAsDataURL=original;FileReader.prototype.readAsDataURL=function(blob){(window as any).releaseRead=()=>original.call(this,blob);};});
 await open();await page.locator('input[type=file]').setInputFiles(files[0]);await page.getByText(/读取 one.txt/).waitFor();await page.getByRole('button',{name:'关闭选择',exact:true}).click();await page.evaluate(()=>(window as any).releaseRead());await page.waitForTimeout(100);assert.equal(uploads,3);await page.evaluate(()=>(window as any).restoreReader());
 // A late receipt after closing cannot open or advance the old picker.
 await open();await page.locator('input[type=file]').setInputFiles(files);await page.getByText(/等待 one.txt 的上传回执/).waitFor();await page.getByRole('button',{name:'关闭选择',exact:true}).click();pending!.socket.send(JSON.stringify({type:'receipt',requestId:pending!.id,ok:true,data:{name:'one.txt',path:'C:/fixture/one.txt',kind:'file'}}));await page.waitForTimeout(100);assert.equal(uploads,4);assert.equal(await page.locator('.remote-file-dialog').count(),0);
 // A failed phone upload while the first directory request is pending must not strand the browser.
 let releaseBrowse:(()=>Promise<void>)|undefined;
 await page.route('**/api/files/browse?**',route=>{releaseBrowse=()=>route.fulfill({json:{path:'C:/fixture',parent:'C:/',total:1,offset:0,entries:[{name:'ready.txt',path:'C:/fixture/ready.txt',directory:false}]}});});
 await page.locator('#open').click();await page.locator('.remote-file-dialog').waitFor();
 await page.locator('input[type=file]').setInputFiles(Array.from({length:51},(_,i)=>({name:`limit-${i}.txt`,mimeType:'text/plain',buffer:Buffer.from('x')})));
 await page.getByText(/每次最多 50 个文件/).waitFor();await releaseBrowse!();
 await page.getByRole('checkbox',{name:'选择 ready.txt',exact:true}).check();
 assert.equal(await page.getByRole('button',{name:'添加所选附件',exact:true}).isEnabled(),true);
 assert.match(await page.locator('.remote-file-status').innerText(),/每次最多 50 个文件/);assert.equal(uploads,4);
 await page.getByRole('button',{name:'关闭选择',exact:true}).click();
 assert.deepEqual(errors,[]);writeFileSync(resolve(output,'results.json'),JSON.stringify({passed:true,uploads,errors,checks:['confirmed count only','uncertain retained','no retry','read-close prevents send','late receipt ignored','upload failure during directory load recovers']},null,2));console.log('PASS: confirmed upload counts, partial uncertain status, close during read, late receipt, directory loading recovery and no automatic retransmission');
}finally{await browser.close();await server.close();}
