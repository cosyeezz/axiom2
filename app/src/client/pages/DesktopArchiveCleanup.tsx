import { useEffect, useRef, useState } from 'react';
import { MaintenanceTaskView } from '../maintenance/MaintenanceView.js';
import type { MaintenanceTask } from '../../shared/maintenance.js';
import { desktopInvoke } from './desktop-bridge.js';
type Item = { id?: string; label: string; path?: string; note?: string; size?: number; state: 'remove' | 'retain' | 'unverified' | 'removed' | 'remaining' };
type Preview = { token: string | null; items: Item[] };
type Update = { archiveCleanup?: Preview; job: { kind: string; running: boolean; task?: MaintenanceTask; cleanup?: { complete: boolean; items: Item[] } } | null };
const labels = { remove: '可清理', retain: '保留', unverified: '未核实', removed: '已移除', remaining: '仍有残留' };
export default function DesktopArchiveCleanup({ onRescan }: { onRescan: () => Promise<boolean> }) {
  const [state, setState] = useState<Update>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ token: string; item: Item }>();
  const lock = useRef(false), mounted = useRef(true), rescanned = useRef(''), rescan = useRef(onRescan); rescan.current = onRescan;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const job = state?.job, running = !!job?.running;
  const own = job?.kind === 'archive-preview' || job?.kind === 'archive-remove';
  const ready = !error && !running && job?.kind === 'archive-preview' && job.task?.status === 'succeeded' && !!state?.archiveCleanup?.token;
  async function act(action: string, payload?: unknown) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    if (action === 'archive-preview') setConfirmation(undefined);
    try {
      const next = await desktopInvoke<Update>('axiom_update', { action, version: payload ? JSON.stringify(payload) : null }, 55_000);
      if (!next || !Object.hasOwn(next, 'job')) throw Error('维护状态不完整。');
      if (mounted.current) setState(next);
      if (next.job?.kind === 'archive-remove' && !next.job.running && next.job.task && rescanned.current !== next.job.task.id) {
        if (await rescan.current()) rescanned.current = next.job.task.id;
      }
    } catch (cause) {
      if (mounted.current) setError(`${cause instanceof Error ? cause.message : String(cause)} 请读取归档清理任务核实；不要重复提交。`);
      if (action === 'archive-remove') await rescan.current();
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!running || !own || error) return;
    const timer = setTimeout(() => void act('status'), 1500); return () => clearTimeout(timer);
  }, [state, running, own, error]);
  async function remove() {
    if (!confirmation?.item.id || lock.current) return;
    const selected = confirmation; setConfirmation(undefined);
    setState(value => value?.archiveCleanup ? { ...value, archiveCleanup: { ...value.archiveCleanup, token: null } } : value);
    await act('archive-remove', { token: selected.token, id: selected.item.id, confirm: true });
  }
  const items = job?.kind === 'archive-remove' ? job.cleanup?.items : ready ? state?.archiveCleanup?.items : undefined;
  return <section className="environment-item" aria-label="下载归档清理">
    <h3>后台下载归档</h3>
    <p className="connect-update-detail">逐项清理已核实的后台更新下载包，无需启动后台或联网。旧版本、安装任务归档、临时运行目录及公共缓存仍需核实；清理下载包后，再次更新可能需要重新下载。</p>
    <div className="connect-actions"><button className="connect-secondary" disabled={busy || running} onClick={() => void act('archive-preview')}>预览下载归档</button><button className="connect-secondary" disabled={busy} onClick={() => void act('status')}>读取归档清理任务</button></div>
    {error && <p className="connect-error" role="alert">{error}</p>}
    {own && job.task && <MaintenanceTaskView task={job.task} connected onCancel={() => act('cancel', { id: job.task!.id })} onExtend={budgets => act('extend', { id: job.task!.id, budgets })} onReconcile={() => act('reconcile', { id: job.task!.id })} />}
    {items && <ul className="environment-locations">{items.map((item, index) => <li key={item.id ?? index}><div className="environment-location-title"><span>{item.label}</span><span>{labels[item.state]}</span></div>{item.path && <code>{item.path}</code>}{item.size != null && <span>{(item.size / 1024 / 1024).toFixed(2)} MiB</span>}{item.note && <p className="connect-update-detail">{item.note}</p>}{ready && item.id && item.state === 'remove' && <button className="connect-secondary" disabled={busy || !!confirmation} onClick={() => setConfirmation({ token: state!.archiveCleanup!.token!, item })}>清理此归档</button>}</li>)}</ul>}
    {ready && !items?.some(item => item.state === 'remove') && <p className="connect-update-detail">本次未发现可直接清理的下载归档；这不代表其他安装空间没有残留。</p>}
    {confirmation && <div className="environment-confirm inline-confirmation" role="group" aria-label="确认归档清理"><p>确认删除这个下载包：</p><code>{confirmation.item.path}</code><p>程序、用户数据和维护记录保留。</p><div className="connect-actions"><button className="connect-secondary" disabled={busy} onClick={() => setConfirmation(undefined)}>取消</button><button className="connect-secondary confirm-danger" disabled={busy} onClick={() => void remove()}>确认清理归档</button></div></div>}
    {job?.kind === 'archive-remove' && job.cleanup && <p className="connect-update-detail">{job.cleanup.complete ? '所选下载归档路径已移除。' : '归档清理结果仍需核实。'} 其他安装残留请继续查看环境扫描。</p>}
  </section>;
}
