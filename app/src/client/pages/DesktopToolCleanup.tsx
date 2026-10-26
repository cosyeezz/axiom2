import { useEffect, useRef, useState } from 'react';
import { desktopInvoke, DesktopResponsePendingError } from './desktop-bridge.js';
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
    const response = await desktopInvoke<{ requestId: string; data: T }>('axiom_cleanup', { request: { op, params, requestId } }, 95_000);
    if (!response || response.requestId !== requestId || !response.data) throw new DesktopResponsePendingError('清理响应无效，结果尚未确认，请读取状态核实。');
    return response;
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
    if (pendingRef.current !== current) return;
    let result: CleanupProgress;
    if (!current.accepted) {
      result = { state: 'unknown', message: '提交响应丢失，已读取当前状态；尚不能将其他任务或文件消失归因于本次请求。请结合维护历史核实后再决定是否重新清理。' };
    } else {
      result = cleanupProgress(current.row, data, current.jobId);
    }
    let next = { ...current, result }; save(next);
    if (['verified', 'failed'].includes(result.state) && !current.rescanned) {
      const rescanned = await rescan.current();
      if (pendingRef.current === next) { next = { ...next, rescanned }; save(next); }
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
    const accept = async (response: { requestId: string; data: CleanupStates[CleanupFamily] }) => {
      if (!mounted.current || pendingRef.current?.requestId !== requestId || pendingRef.current.accepted) return;
      if (!response || response.requestId !== requestId || !response.data) throw new DesktopResponsePendingError('清理响应无效，结果尚未确认。');
      save({ row, requestId, accepted: true, jobId: acceptedCleanupJob(row, response.data, requestId), result: { state: 'running', message: '清理请求已受理，正在核实结果…' } });
      await verify();
    };
    try {
      const response = await request<CleanupStates[CleanupFamily]>(row.op, { ...row.params, revision: row.revision, confirm: true, ...(row.credentials && credentials ? { clearCredentials: true } : {}) }, requestId);
      await accept(response);
    } catch (cause) {
      const current = pendingRef.current;
      if (current?.requestId === requestId) save({ ...current, result: { state: 'unknown', message: cause instanceof Error ? cause.message : String(cause) } });
      if (cause instanceof DesktopResponsePendingError && cause.response) {
        void cause.response.then(value => accept(value as { requestId: string; data: CleanupStates[CleanupFamily] })).catch(failure => {
          const latest = pendingRef.current;
          if (mounted.current && latest?.requestId === requestId && latest.result?.state !== 'verified' && latest.result?.state !== 'failed') save({ ...latest, result: { state: 'unknown', message: '原清理请求结果尚未确认，请核实状态，不要重复提交。' } });
        });
      }
    }
  }
  const watching = !!pending && !['verified', 'failed'].includes(pending.result?.state ?? 'unknown');
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => { if (!lock.current) void run(verify); }, 1500);
    return () => clearInterval(timer);
  }, [watching]);
  useEffect(() => { void run(refresh); }, []);
  const rows = cleanupRows(states).filter(row => !['rea:Skill', 'rea:Mcp', 'rtk:stats', 'rtk:originals'].includes(row.id) && (row.available || row.readOnly && !!(states.rtk?.version || states.rtk?.executable || states.rtk?.cleanupPaths?.length)));
  const incomplete = Object.values(errors).some(Boolean);
  return <section className="environment-item" aria-label="工具与资源卸载">
    <div className="connect-updates-heading"><h3>内置工具与资源</h3><button className="connection-text-button" aria-label="刷新组件列表" disabled={busy || !!watching} onClick={() => void run(refresh)}>{busy ? '正在读取…' : '刷新'}</button></div>
    {incomplete && <p className="connect-update-detail" role="status">部分组件状态暂未读到，启动本机后台后可刷新列表。</p>}
    {!busy && !incomplete && !rows.length && <p className="connect-update-detail">暂无已登记的可卸载工具或资源。</p>}
    {error && <p className="connect-message" role="status">{error}</p>}

    {states.rtk?.dataCleanupError && <p className="connect-error">RTK 保留数据：{states.rtk.dataCleanupError}</p>}
    {(['stats', 'originals'] as const).map(kind => states.rtk?.dataCleanupErrors?.[kind] && <p className="connect-error" key={kind}>RTK {kind === 'stats' ? '效果记录' : '保留原文'}：{states.rtk.dataCleanupErrors[kind]}</p>)}
    {rows.map(row => <div className="environment-cleanup-row" key={row.id}>
      <div><strong>{row.label}</strong>{row.readOnly && <p className="connect-update-detail">启动本机后台后可卸载</p>}</div>
      <button className="connect-secondary" disabled={busy || !!pending || !row.available || row.readOnly} onClick={() => void run(() => inspect(row))}>{row.op === 'rea.clearDownloads' ? '清理' : '卸载'}</button>
    </div>)}
    {preview && <div className="environment-confirm inline-confirmation" role="group" aria-label="确认工具清理范围">
      <strong>{preview.op === 'rea.clearDownloads' ? '清理' : '卸载'} {preview.label}？</strong>
      <p>{preview.op === 'rea.clearDownloads' ? '删除该组件已下载的安装包，再次安装时需要重新下载。' : '移除此组件的托管程序或接入，保留项目、会话和个人设置。'}外部安装与共享缓存不会删除。</p>
      {preview.scope.filter(item => !/^(托管版本目录|数据路径|登记下载目录|只读路径)：/.test(item)).map((item, index) => <p key={index}>{item}</p>)}
      {preview.family === 'rea' && preview.op !== 'rea.clearDownloads' && <p>请先退出正在使用此组件的分析任务。</p>}
      <details><summary>查看范围与保留项</summary><ul>{preview.scope.map((item, index) => <li key={index}>{item}</li>)}</ul><ul>{preview.retained.map((item, index) => <li key={index}>保留：{item}</li>)}</ul>{preview.warning && <p>{preview.warning}</p>}</details>
      <div className="connect-actions"><button className="connect-secondary" disabled={busy} onClick={() => setPreview(undefined)}>取消</button>
      {!preview.readOnly && preview.available && <button className="connect-secondary confirm-danger" disabled={busy} onClick={() => void run(remove)}>{preview.op === 'rea.clearDownloads' ? '确认清理' : '确认卸载'}</button>}</div>
    </div>}
    {pending && <div className="environment-confirm" aria-live="polite">
      <strong>{pending.row.label} · {pending.result?.state === 'verified' ? '选定范围已核实' : pending.result?.state === 'running' ? '处理中' : '尚未完成核实'}</strong>
      <p className={pending.result?.state === 'failed' ? 'connect-error' : 'connect-update-detail'} role={pending.result?.state === 'failed' ? 'alert' : 'status'}>{pending.result?.message}</p>
      <div className="connect-actions"><button className="connect-secondary" disabled={busy} onClick={() => void run(verify)}>刷新状态</button>
      {!watching && pending.accepted && ['verified', 'failed'].includes(pending.result?.state ?? '') && <button className="connect-secondary" disabled={busy} onClick={() => { save(undefined); setPreview(undefined); }}>关闭</button>}</div>
    </div>}
  </section>;
}
