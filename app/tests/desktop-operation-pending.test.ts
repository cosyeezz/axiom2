import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from '../src/client/pages/desktop-bridge.js';
import { observesSubmission, isSubmissionRefused, validOperationJob } from '../src/client/pages/desktop-operation.js';
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });
function bridge(invoke: (command: string, args: object) => Promise<unknown>) { Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI_INTERNALS__: { invoke } } }); }
test('deadline preserves the original invocation, its args and its eventual acknowledgement without replay', async () => {
  let release!: (value: unknown) => void, calls = 0;
  const response = new Promise(resolve => { release = resolve; });
  const args = { action: 'pi-uninstall', version: JSON.stringify({ token:'one-use', confirm:true }) };
  bridge(async (command, actual) => { calls++; assert.equal(command,'axiom_update');assert.equal(actual,args);return response; });
  let pending!: DesktopResponsePendingError;
  await assert.rejects(desktopInvoke('axiom_update', args, 5), cause => { assert.ok(cause instanceof DesktopResponsePendingError); pending=cause;return true; });
  assert.equal(isDesktopResponsePending(pending),true);assert.equal(pending.code,'response-unconfirmed');
  release({ accepted:true });assert.deepEqual(await pending.response,{ accepted:true });assert.equal(calls,1);
});
test('a late native refusal is observed from the original promise, never submitted again', async()=>{
  let refuse!: (reason: unknown) => void, calls=0;
  bridge(()=>{calls++;return new Promise((_,reject)=>{refuse=reject;});});
  let pending!: DesktopResponsePendingError;
  await assert.rejects(desktopInvoke('axiom_setup',{action:'service'},5),cause=>{assert.ok(cause instanceof DesktopResponsePendingError);pending=cause;return true;});
  refuse('已有安装任务正在执行或结果待核实。');await assert.rejects(pending.response!,cause=>{assert.equal(isSubmissionRefused(cause),true);return true;});assert.equal(calls,1);
});
test('transport uncertainty is neutral, not a blanket conversion of confirmed execution failures',async()=>{
  for(const message of ['服务操作超时，请刷新状态后查看服务日志。','检查更新超时；已提交的更新任务会继续运行。','清理响应无效；请读取状态核实结果','清理响应读取失败','清理响应超过读取上限']) {
    bridge(async()=>{throw message;});await assert.rejects(desktopInvoke('axiom_update'),cause=>{assert.ok(cause instanceof Error);assert.equal(isDesktopResponsePending(cause),true,message);return true;});
  }
  for(const message of ['下载无数据超时，执行器已确认退出','SHA-256 不符，已拒绝安装','退出凭据尚未完整，归属记录保留','网络错误'])assert.equal(isDesktopResponsePending(Error(message)),false,message);
});
test('only exact pre-claim refusals establish that no task was accepted',()=>{
  assert.equal(isSubmissionRefused('已有更新正在进行，请等待完成。'),true);
  for(const message of ['网络断开','退出凭据尚未确认','npm 执行失败','清理响应无效；请读取状态核实结果','安装失败：已有更新正在进行，请等待完成。'])assert.equal(isSubmissionRefused(Error(message)),false,message);
});
test('malformed task snapshots cannot acknowledge a write',()=>{
  for (const value of [undefined, null, {}, {kind:'pi',running:false}, {kind:'pi',running:false,task:{}}, {kind:'pi',running:true,task:{id:'new',createdAt:Date.now()}}]) assert.equal(validOperationJob(value), false);
});
test('an old, empty, wrong-action or pre-submission job cannot acknowledge a timed-out mutation',()=>{
  const witness={action:'pi-uninstall',previousId:'old',sentAt:100};
  for(const job of [null,undefined,{kind:'pi-uninstall'},{kind:'pi-uninstall',task:{id:'old',createdAt:101}},{kind:'pi-remove-preview',task:{id:'new',createdAt:101}},{kind:'pi-uninstall',task:{id:'new',createdAt:99}}])assert.equal(observesSubmission(witness,job),false);
  assert.equal(observesSubmission(witness,{kind:'pi-uninstall',task:{id:'new',createdAt:100}}),true);
});
