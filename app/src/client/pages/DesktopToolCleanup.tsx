import { useEffect, useRef, useState } from 'react';
import type { MaintenanceState } from '../../shared/maintenance.js';
import { desktopInvoke } from './desktop-bridge.js';
import { acceptedCleanupJob, cleanupFamilies, cleanupProgress, cleanupRows, type CleanupFamily, type CleanupRow, type CleanupStates, type CleanupProgress } from './desktop-cleanup.js';
type Pending = { row: CleanupRow; requestId: string; jobId?: string; accepted: boolean; result?: CleanupProgress; rescanned?: boolean };
const storageKey = 'axiom.desktop.cleanup.pending';
function saved(): Pending | undefined {
  try { const value = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (value && cleanupFamilies.includes(value.row?.family) && typeof value.requestId === 'string' && typeof value.accepted === 'boolean') return value; } catch {}
}
export default function DesktopToolCleanup({ onRescan }: { onRescan: () => Promise<boolean> }) {
  const [states, setStates] = useState<Partial<CleanupStates>>({});
  const [errors, setErrors] = useState<Partial<Record<CleanupFamily, string>>>({});
  const [preview, setPreview] = useState<CleanupRow>();
  const [credentials, setCredentials] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>(saved);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), mounted = useRef(true), pendingRef = useRef(pending);
  const rescan = useRef(onRescan); rescan.current = onRescan;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function save(value: Pending | undefined) {
    pendingRef.current = value;
    if (mounted.current) setPending(value);
    try { if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch {}
  }
  async function request<T>(op: string, params: object = {}, requestId = crypto.randomUUID()) {
    return desktopInvoke<{ requestId: string; data: T }>('axiom_cleanup', { request: { op, params, requestId } }, 95_000);
  }
  async function read(family: CleanupFamily) {
    const { data } = await request<CleanupStates[CleanupFamily]>(`${family}.get`);
    if (!data || typeof data.revision !== 'string') throw Error('后台状态不完整，请更新后台并重新核实。');
    // Validate list-bearing snapshots before presenting destructive controls.
    if (family === 'resources' && (!Array.isArray((data as CleanupStates['resources']).items) || !Array.isArray((data as CleanupStates['resources']).scopes) || !Array.isArray((data as CleanupStates['resources']).warnings))) throw Error('资源状态不完整。');
    if (family === 'modelProxy' && !(data as CleanupStates['modelProxy']).installations) throw Error('代理状态不完整。');
    if (mounted.current) { setStates(previous => ({ ...previous, [family]: data })); setErrors(previous => ({ ...previous, [family]: undefined })); }
    return data;
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function refresh() {
    setPreview(undefined);
    for (const family of cleanupFamilies) {
      if (!mounted.current) return;
      try { await read(family); } catch (cause) { setErrors(previous => ({ ...previous, [family]: String(cause instanceof Error ? cause.message : cause) })); }
    }
  }
  async function inspect(row: CleanupRow) {
    setPreview(undefined); setCredentials(false);
    const data = await read(row.family);
    const current = cleanupRows({ [row.family]: data }).find(item => item.id === row.id);
    if (!current || (!current.available && !current.readOnly) || (!current.revision && !current.params.cleanupRevision)) throw Error('此项目状态已变化或不支持自动卸载，请查看最新结果。');
    setPreview(current);
  }
  async function verify() {
    const current = pendingRef.current; if (!current) return;
    const data = await read(current.row.family);
    let result: CleanupProgress;
    if (!current.accepted) {
      result = { state: 'unknown', message: '提交响应丢失，已读取当前状态；尚不能将其他任务或文件消失归因于本次请求。请结合维护历史核实后再决定是否重新清理。' };
    } else {
      let history: MaintenanceState | undefined;
      if (current.row.op === 'modelProxy.importerUninstall') {
        try { history = (await request<MaintenanceState>('maintenance.get')).data; } catch { /* Keep unknown, but still rescan independently. */ }
      }
      result = cleanupProgress(current.row, data, current.jobId, history);
    }
    let next = { ...current, result }; save(next);
    if (result.state !== 'running' && !current.rescanned) {
      const rescanned = await rescan.current();
      if (pendingRef.current?.requestId === current.requestId) { next = { ...next, rescanned }; save(next); }
    }
  }
  async function remove() {
    if (!preview) return;
    const row = preview, requestId = crypto.randomUUID();
    if (row.readOnly || !row.available) throw Error('此范围仅供查看，缺少退出证明时不允许离线删除。');
    if (row.family === 'rtk') {
      const fresh = cleanupRows({ rtk: await read('rtk') as CleanupStates['rtk'] }).find(item => item.id === row.id);
      if (!fresh?.available || fresh.readOnly || fresh.revision !== row.revision || fresh.params.cleanupRevision !== row.params.cleanupRevision) {
        setPreview(fresh?.readOnly ? fresh : undefined);
        throw Error('RTK 执行能力或范围已变化，请重新核实；未提交删除请求。');
      }
    }
    setPreview(undefined);
    // Persist the attempt before dispatch. A timeout never causes a replay.
    save({ row, requestId, accepted: false, result: { state: 'running', message: '正在提交已确认的清理请求…' } });
    try {
      const response = await request<CleanupStates[CleanupFamily]>(row.op, { ...row.params, revision: row.revision, confirm: true, ...(row.credentials && credentials ? { clearCredentials: true } : {}) }, requestId);
      save({ row, requestId, accepted: true, jobId: acceptedCleanupJob(row, response.data, requestId), result: { state: 'running', message: '清理请求已受理，正在复读状态并核实结果…' } });
      await verify();
    } catch (cause) {
      const current = pendingRef.current;
      if (current) save({ ...current, result: { state: 'unknown', message: cause instanceof Error ? cause.message : String(cause) } });
    }
  }
  const watching = pending?.accepted && pending.result?.state === 'running';
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => { if (!lock.current) void run(verify); }, 1500);
    return () => clearInterval(timer);
  }, [watching]);
  const rows = cleanupRows(states);
  return <section className="environment-item" aria-label="工具与资源卸载">
    <div className="connect-updates-heading"><h2>工具与资源卸载</h2><button className="connect-secondary" disabled={busy || !!watching} onClick={() => void run(refresh)}>{busy ? '正在读取…' : '读取可卸载项目'}</button></div>
    <p className="connect-update-detail">管理这台电脑登记的 MCP、技能、资源包和内置工具。RTK 可在后台退出后通过客户端内置维护程序查看范围；缺少历史工作进程退出证明时不能离线删除。工具与资源的自动卸载需要本机后台运行。卸载后会核实任务结果并重新扫描环境；外部安装与共享缓存会单独保留。</p>
    {error && <p className="connect-error" role="alert">{error}</p>}
    {Object.entries(errors).map(([family, message]) => message && <p className="connect-error" key={family}>{family}：{message}</p>)}
    {states.rtk?.dataCleanupError && <p className="connect-error">RTK 保留数据：{states.rtk.dataCleanupError}</p>}
    {(['stats', 'originals'] as const).map(kind => states.rtk?.dataCleanupErrors?.[kind] && <p className="connect-error" key={kind}>RTK {kind === 'stats' ? '效果记录' : '保留原文'}：{states.rtk.dataCleanupErrors[kind]}</p>)}
    {rows.map(row => <div className="environment-cleanup-row" key={row.id}>
      <div><strong>{row.label}</strong>{row.warning && <p className="connect-update-detail">{row.warning}</p>}</div>
      <button className="connect-secondary" disabled={busy || !!pending || (!row.available && !row.readOnly)} onClick={() => void run(() => inspect(row))}>{row.readOnly ? '查看只读范围' : row.available ? row.op.startsWith('rtk.cleanup') || row.op === 'rea.clearDownloads' ? '查看数据清理范围' : '查看卸载范围' : '当前不可自动清理'}</button>
    </div>)}
    {preview && <div className="environment-confirm" role="group" aria-label="确认工具清理范围">
      <strong>{preview.label}</strong><p>{preview.readOnly ? '只读范围（不会删除）：' : '将执行：'}</p><ul>{preview.scope.map((item, i) => <li key={i}>{item}</li>)}</ul>
      <p>保留：</p><ul>{preview.retained.map((item, i) => <li key={i}>{item}</li>)}</ul>
      {preview.warning && <p className="environment-issue">{preview.warning}</p>}
      {preview.credentials && <label><input type="checkbox" checked={credentials} onChange={event => setCredentials(event.target.checked)} /><span>同时清除此 MCP 的专属凭据（仍被共享引用的凭据保留）</span></label>}
      <p className="connect-update-detail">执行时再次核对配置版本、所列目录身份和占用；发生变化会拒绝本次操作，需要重新查看范围。</p>
      <div className="connect-actions"><button className="connect-secondary" disabled={busy} onClick={() => setPreview(undefined)}>返回</button>
      {!preview.readOnly && preview.available && <button className="connect-secondary" disabled={busy} onClick={() => void run(remove)}>确认清理所列范围</button>}</div>
    </div>}
    {pending && <div className="environment-confirm" aria-live="polite">
      <strong>{pending.row.label} · {pending.result?.state === 'verified' ? '选定范围已核实' : pending.result?.state === 'running' ? '处理中' : '尚未完成核实'}</strong>
      <p>{pending.result?.message}</p><p className="connect-update-detail">请求：{pending.requestId}{pending.jobId ? `；任务：${pending.jobId}` : ''}</p>
      <ul>{pending.row.retained.map((item, i) => <li key={i}>保留：{item}</li>)}</ul>
      <p className="connect-update-detail">{pending.rescanned ? '已重新扫描本机已知安装与残留；请查看下方结果。' : '环境复扫尚未完成。'} 未核实来源与保留项仍存在时，不表示环境已清空。</p>
      <div className="connect-actions"><button className="connect-secondary" disabled={busy} onClick={() => void run(verify)}>重新核实与扫描</button>
      {!watching && <button className="connect-secondary" disabled={busy} onClick={() => { save(undefined); setPreview(undefined); }}>关闭结果，重新选择项目</button>}</div>
    </div>}
  </section>;
}
