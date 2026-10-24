import { useEffect, useRef, useState } from 'react';
import { MaintenanceTaskView } from '../maintenance/MaintenanceView.js';
import type { MaintenanceTask } from '../../shared/maintenance.js';
import { desktopInvoke } from './desktop-bridge.js';

type Item = { label: string; path?: string; state: 'remove' | 'retain' | 'unverified' | 'removed' | 'remaining'; note?: string };
type Preview = { token: string | null; version: string; packageRoot: string; items: Item[]; resume?: boolean };
type Update = { serviceRemoval?: Preview | null; serviceRemovalPending?: boolean; job: { kind: string; running: boolean; message: string; task?: MaintenanceTask; cleanup?: { items: Item[]; complete: boolean } } | null };
const labels = { remove: '将移除', retain: '保留', unverified: '未核实', removed: '已移除', remaining: '仍有残留' };
export default function DesktopServiceRemoval({ onRescan }: { onRescan: () => Promise<boolean> }) {
  const [state, setState] = useState<Update>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Preview>();
  const [consent, setConsent] = useState(false);
  const lock = useRef(false), mounted = useRef(true), rescanned = useRef('');
  const rescan = useRef(onRescan); rescan.current = onRescan;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const job = state?.job, running = !!job?.running;
  const ownJob = job?.kind === 'service-uninstall' || job?.kind === 'service-remove-preview';
  const preview = state?.serviceRemoval;
  const ready = !error && !running && job?.kind === 'service-remove-preview' && job.task?.status === 'succeeded' && preview?.token && Array.isArray(preview.items);
  async function act(action: string, payload?: unknown) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    if (action === 'service-remove-preview') { setConfirmed(undefined); setConsent(false); }
    try {
      const next = await desktopInvoke<Update>('axiom_update', { action, version: payload ? JSON.stringify(payload) : null }, 55_000);
      if (!next || !Object.hasOwn(next, 'job')) throw Error('维护状态不完整。');
      if (mounted.current) setState(next);
      if (next.job?.kind === 'service-uninstall' && next.job.task && !next.job.running && rescanned.current !== next.job.task.id) {
        if (await rescan.current()) rescanned.current = next.job.task.id;
      }
    } catch (cause) { if (mounted.current) setError(`${cause instanceof Error ? cause.message : String(cause)} 请读取清理任务核实；不要重复提交。`); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  useEffect(() => {
    if (!running || !ownJob || error) return;
    const timer = setTimeout(() => { void act('status'); }, 1500);
    return () => clearTimeout(timer);
  }, [state, running, ownJob, error]);
  async function remove() {
    if (!confirmed?.token || !consent || lock.current) return;
    const token = confirmed.token; setConfirmed(undefined); setConsent(false);
    setState(value => value?.serviceRemoval ? { ...value, serviceRemoval: { ...value.serviceRemoval, token: null } } : value);
    await act('service-uninstall', { token, confirm: true });
  }
  const items = job?.kind === 'service-uninstall' ? job.cleanup?.items : ready ? preview?.items : undefined;
  return <section className="environment-item" aria-label="托管后台卸载">
    <h3>托管后台与应用内 Pi</h3>
    <p className="connect-update-detail">停止当前电脑的托管后台后，移除已确认的后台程序、应用内 Pi 和命令入口。会话、项目及独立工具保留。需要卸载独立工具时，请先完成上方工具清理。</p>
    <div className="connect-actions"><button className="connect-secondary" disabled={busy || running} onClick={() => void act('service-remove-preview')}>预览后台卸载</button><button className="connect-secondary" disabled={busy} onClick={() => void act('status')}>读取后台清理任务</button></div>
    {error && <p className="connect-error" role="alert">{error}</p>}
    {state?.serviceRemovalPending && <p className="environment-issue">上次后台卸载尚未完成。请重新预览剩余范围，再确认继续清理；完成前不能重新安装或更新后台。</p>}
    {ownJob && job.task && <MaintenanceTaskView task={job.task} connected onCancel={() => act('cancel', { id: job.task!.id })} onExtend={budgets => act('extend', { id: job.task!.id, budgets })} onReconcile={() => act('reconcile', { id: job.task!.id })} />}
    {items && <ul className="environment-locations">{items.map((item, index) => <li key={index}><div className="environment-location-title"><span>{item.label}</span><span>{labels[item.state]}</span></div>{item.path && <code>{item.path}</code>}{item.note && <p className="connect-update-detail">{item.note}</p>}</li>)}</ul>}
    {ready && !confirmed && <button className="connect-secondary" disabled={busy} onClick={() => { setConfirmed(preview!); setConsent(false); }}>{preview?.resume ? '继续清理后台残留' : '卸载此后台'}</button>}
    {confirmed && <div className="environment-confirm" role="group" aria-label="确认后台卸载"><p>将卸载后台 {confirmed.version}：</p><code>{confirmed.packageRoot}</code><p>本机工作台会断开，运行中的任务会随后台停止。数据目录和独立工具保留，程序需要重新安装后才能使用。</p><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我已保存工作，并确认停止后台、删除上述程序范围</span></label><div className="connect-actions"><button className="connect-secondary" disabled={busy || !consent} onClick={() => void remove()}>确认卸载后台</button><button className="connect-secondary" disabled={busy} onClick={() => setConfirmed(undefined)}>返回</button></div></div>}
    {job?.kind === 'service-uninstall' && job.cleanup && <p className="connect-update-detail">{job.cleanup.complete ? '所选后台程序路径已移除。' : '仍有残留，请重新预览并核实。'} 保留项、其他安装及未核实来源仍需查看环境扫描。</p>}
  </section>;
}
