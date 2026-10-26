// Desktop-only whitelist adapter. The native host supplies the locally registered
// service URL; the webview can supply only an operation and its fixed parameters.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const reads = new Set(['resources.get', 'rea.get', 'rtk.get', 'opencli.get', 'modelProxy.get', 'maintenance.get']);
const removals = new Map([
  ['resources.remove', ['id', 'clearCredentials']], ['rea.uninstall', []],
  ['rea.engine-uninstall', ['engine']], ['rea.clearDownloads', ['engine']], ['rea.uninstallSkill', []], ['rea.uninstallMcp', []],
  ['rtk.uninstall', []], ['rtk.cleanupStats', []], ['rtk.cleanupOriginals', []], ['opencli.uninstall', []],
  ['modelProxy.uninstall', ['kernel']],
]);
const scopedRemovals = new Set(['rtk.uninstall', 'rtk.cleanupStats', 'rtk.cleanupOriginals', 'opencli.uninstall', 'rea.uninstall', 'rea.engine-uninstall', 'rea.clearDownloads', 'modelProxy.uninstall']);
export function cleanupCommand(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['op', 'params', 'requestId'].includes(key))) throw Error('清理请求无效。');
  const { op, params = {}, requestId = randomUUID() } = input;
  if (typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(requestId)) throw Error('清理请求身份无效。');
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw Error('清理参数无效。');
  if (reads.has(op)) {
    if (Object.keys(params).length) throw Error('读取状态不接受附加参数。');
  } else {
    const fields = removals.get(op), scoped = scopedRemovals.has(op);
    if (!fields || Object.keys(params).some(key => !['revision', 'confirm', ...(scoped ? ['cleanupRevision'] : []), ...fields].includes(key))) throw Error('不支持的清理操作或参数。');
    if (scoped && (typeof params.cleanupRevision !== 'string' || !/^[a-f0-9]{64}$/.test(params.cleanupRevision))) throw Error('请重新读取卸载路径并确认有效的范围摘要。');
    if (params.confirm !== true || typeof params.revision !== 'string' || (!params.revision && !(scoped && params.cleanupRevision)) || params.revision.length > 4096) throw Error('请先读取当前状态并确认清理范围。');
    if (op === 'resources.remove' && (typeof params.id !== 'string' || !params.id || params.id.length > 4096 || params.clearCredentials !== undefined && typeof params.clearCredentials !== 'boolean')) throw Error('资源清理参数无效。');
    if (op === 'rea.engine-uninstall' && !['java', 'ghidra', 'jadx', 'wabt'].includes(params.engine)) throw Error('此引擎不支持托管卸载。');
    if (op === 'rea.clearDownloads' && !['ghidra', 'hopper'].includes(params.engine)) throw Error('请选择已登记的 Ghidra 或 Hopper 下载包。');
    if (op === 'modelProxy.uninstall' && !['xray', 'mihomo'].includes(params.kernel)) throw Error('代理内核无效。');
  }
  return { requestId, op, params };
}
export function cleanupAddress(address) {
  const url = new URL(address);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw Error('清理仅支持当前登记的本机后台。');
  url.protocol = 'ws:'; url.pathname = '/ws'; return url.href;
}
export async function cleanupRequest(address, input, { timeoutMs = 20000, WebSocketClass = WebSocket } = {}) {
  const command = cleanupCommand(input), url = cleanupAddress(address);
  return new Promise((resolve, reject) => {
    const socket = new WebSocketClass(url);
    let finished = false;
    const done = (error, data) => {
      if (finished) return; finished = true; clearTimeout(timer); socket.close();
      if (error) reject(error); else resolve({ requestId: command.requestId, data });
    };
    const timer = setTimeout(() => done(Error('后台响应超时；操作结果尚未确认，请重新读取状态，不要重复提交。')), timeoutMs);
    socket.addEventListener('open', () => socket.send(JSON.stringify(command)));
    socket.addEventListener('message', event => {
      try {
        if (typeof event.data !== 'string' || Buffer.byteLength(event.data) > 8 * 1024 * 1024) throw Error('后台清理响应超过读取范围。');
        const receipt = JSON.parse(event.data);
        if (receipt.type !== 'receipt' || receipt.requestId !== command.requestId) return;
        if (receipt.ok !== true) throw Error(receipt.error?.message || '后台拒绝了清理请求。');
        done(null, receipt.data);
      } catch (error) { done(error); }
    });
    socket.addEventListener('error', () => done(Error('无法连接本机后台，请先启动后台再管理工具与资源。')));
    socket.addEventListener('close', () => done(Error('后台连接已断开；操作结果尚未确认，请重新读取状态。')));
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    let text = '';
    for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 16384) throw Error('清理请求过大。'); }
    const value = await cleanupRequest(process.argv[2], JSON.parse(text));
    process.stdout.write(JSON.stringify(value));
  } catch (error) { process.stdout.write(JSON.stringify({ state: 'error', message: error.message })); process.exitCode = 1; }
}
