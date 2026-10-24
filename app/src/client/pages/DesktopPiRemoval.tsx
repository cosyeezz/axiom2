import { useEffect, useRef, useState } from 'react';
import { MaintenanceTaskView } from '../maintenance/MaintenanceView.js';
import type { MaintenanceTask } from '../../shared/maintenance.js';
import { desktopInvoke } from './desktop-bridge.js';

type Item = { label: string; path?: string; state: 'remove' | 'retain' | 'unverified' | 'removed' | 'remaining'; note?: string };
type Preview = { token: string | null; version: string; packageRoot: string; items: Item[] };
type Update = { pi?: { removal?: Preview | null }; job: { kind: string; running: boolean; message: string; task?: MaintenanceTask; cleanup?: { items: Item[]; complete: boolean } } | null };
const labels = { remove: '将移除', retain: '保留', unverified: '未核实', removed: '已移除', remaining: '仍有残留' };
async function invoke(action: string, payload?: unknown) {
  const value = await desktopInvoke<Update>('axiom_update', { action, version: payload ? JSON.stringify(payload) : null }, 55_000);
  if (!value || !Object.hasOwn(value, 'job')) throw Error('维护状态不完整，请读取清理任务核实。');
  return value;
}
export default function DesktopPiRemoval({ onRescan }: { onRescan: () => Promise<boolean> }) {
  const [state, setState] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const [confirmed, setConfirmed] = useState<Preview | null>(null);
  const pending = useRef(false), rescanned = useRef('');
  const rescan = useRef(onRescan); rescan.current = onRescan;
  const job = state?.job;
  const ownJob = job?.kind === 'pi-uninstall' || job?.kind === 'pi-remove-preview';
  const running = !!job?.running;
  const preview = state?.pi?.removal;
  const ready = !error && !running && job?.kind === 'pi-remove-preview' && job.task?.status === 'succeeded' && preview?.token && Array.isArray(preview.items);
  async function act(action: string, payload?: unknown) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    if (action === 'pi-remove-preview') { setConfirmed(null); setClosed(false); }
    try {
      const next = await invoke(action, payload); setState(next);
      if (next.job?.kind === 'pi-uninstall' && next.job.task && !next.job.running && !['running', 'cancelling', 'unknown'].includes(next.job.task.status) && rescanned.current !== next.job.task.id) {
        if (await rescan.current()) rescanned.current = next.job.task.id;
      }
    } catch (cause) { setError(`${cause instanceof Error ? cause.message : String(cause)} 请读取清理任务核实结果，再重新预览；不要重复提交。`); }
    finally { pending.current = false; setBusy(false); }
  }
  useEffect(() => {
    if (!running || !ownJob || error) return;
    const timer = window.setTimeout(() => { void act('status'); }, 2000);
    return () => window.clearTimeout(timer);
  }, [state, running, ownJob, error]);
  async function remove() {
    if (!confirmed?.token || !closed || pending.current) return;
    const token = confirmed.token;
    setConfirmed(null); setClosed(false);
    // The UI consumes its confirmation before sending; timeout does not authorize retry.
    setState(value => value?.pi?.removal ? { ...value, pi: { ...value.pi, removal: { ...value.pi.removal, token: null } } } : value);
    await act('pi-uninstall', { token, confirm: true, sessionsClosed: true });
  }
  const items = ownJob && job?.kind === 'pi-uninstall' ? job.cleanup?.items : ready ? preview?.items : undefined;
  return <section className="environment-item" aria-label="终端 Pi 卸载">
    <h3>终端 Pi</h3>
    <p className="connect-update-detail">核实所选 Node/npm 的安装后逐项卸载。应用内 Pi 随后台管理；其他命令来源和残留需结合下方扫描检查。</p>
    <div className="connect-actions">
      <button className="connect-secondary" disabled={busy || running} onClick={() => void act('pi-remove-preview')}>预览 Pi 卸载</button>
      <button className="connect-secondary" disabled={busy} onClick={() => void act('status')}>读取清理任务</button>
    </div>
    {error && <p className="connect-error" role="alert">{error}</p>}
    {ownJob && job.task && <MaintenanceTaskView task={job.task} connected onCancel={() => act('cancel', { id: job.task!.id })} onExtend={budgets => act('extend', { id: job.task!.id, budgets })} onReconcile={() => act('reconcile', { id: job.task!.id })} />}
    {items && <ul className="environment-locations">{items.map((item, index) => <li key={index}><div className="environment-location-title"><span>{item.label}</span><span>{labels[item.state]}</span></div>{item.path && <code>{item.path}</code>}{item.note && <p className="connect-update-detail">{item.note}</p>}</li>)}</ul>}
    {ready && !confirmed && <button className="connect-secondary" disabled={busy} onClick={() => { setConfirmed(preview!); setClosed(false); }}>卸载此终端 Pi</button>}
    {confirmed && <div className="environment-confirm" role="group" aria-label="确认 Pi 卸载">
      <p>将卸载终端 Pi {confirmed.version}：</p><code>{confirmed.packageRoot}</code>
      <p>程序和 npm 命令入口将被移除，设置及共享缓存保留。外部终端任务不会自动结束。</p>
      <label><input type="checkbox" checked={closed} onChange={event => setClosed(event.target.checked)} /><span>我已关闭使用此安装的终端会话，并确认上述范围</span></label>
      <div className="connect-actions"><button className="connect-secondary" disabled={busy || !closed} onClick={() => void remove()}>确认卸载</button><button className="connect-secondary" disabled={busy} onClick={() => setConfirmed(null)}>返回</button></div>
    </div>}
    {job?.kind === 'pi-uninstall' && job.cleanup && <p className="connect-update-detail">{job.cleanup.complete ? '所列程序路径已移除；保留及未核实项仍需分别处理。' : '仍有残留；请核实任务详情并重新预览。'} 下方环境扫描用于继续检查其他安装与残留。</p>}
  </section>;
}
