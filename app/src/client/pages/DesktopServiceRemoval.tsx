import { useEffect, useRef, useState } from 'react';
import { MaintenanceTaskView } from '../maintenance/MaintenanceView.js';
import type { MaintenanceTask } from '../../shared/maintenance.js';
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from './desktop-bridge.js';
import { observesSubmission, isSubmissionRefused, validOperationJob, type OperationWitness } from './desktop-operation.js';

type Item = { label: string; path?: string; state: 'remove' | 'retain' | 'unverified' | 'removed' | 'remaining'; note?: string };
type Preview = { token: string | null; version: string; packageRoot: string; items: Item[]; resume?: boolean };
type Update = { serviceRemoval?: Preview | null; serviceRemovalPending?: boolean; job: { kind: string; running: boolean; reconciled?: boolean; servicePending?: boolean; message: string; task?: MaintenanceTask; cleanup?: { items: Item[]; complete: boolean } } | null };
const labels = { remove: '将移除', retain: '保留', unverified: '未核实', removed: '已移除', remaining: '仍有残留' };
export default function DesktopServiceRemoval({ onRescan, installed }: { onRescan: () => Promise<boolean>; installed?: boolean }) {
  const [state, setState] = useState<Update>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Preview>();
  const [consent, setConsent] = useState(false);
  const [uncertain, setUncertain] = useState(false), [neutral, setNeutral] = useState(false);
  const awaiting = useRef<OperationWitness | null>(null), intent = useRef(false);
  const windows = /Win/i.test(navigator.platform);
  const lock = useRef(false), mounted = useRef(true), rescanned = useRef('');
  const rescan = useRef(onRescan); rescan.current = onRescan;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const job = state?.job, running = !!job?.running;
  const ownJob = job?.kind === 'service-uninstall' || job?.kind === 'service-remove-preview';
  const preview = state?.serviceRemoval;
  const ready = !busy && !uncertain && !error && !running && job?.kind === 'service-remove-preview' && job.task?.status === 'succeeded' && preview?.token && Array.isArray(preview.items);
  async function act(action: string, payload?: unknown) {
    if (lock.current || awaiting.current && ['service-remove-preview', 'service-uninstall'].includes(action)) return;
    lock.current = true; setBusy(true); setError('');
    if (action === 'service-remove-preview') { intent.current = true; setConfirmed(undefined); setConsent(false); }
    const attempt = { action, previousId: state?.job?.task?.id, sentAt: Date.now() };
    const accept = (next: Update) => {
      if (!mounted.current) return;
      if (!next || !Object.hasOwn(next, 'job') || next.job !== null && !validOperationJob(next.job) || ['service-remove-preview', 'service-uninstall'].includes(action) && next.job?.kind !== action) throw new DesktopResponsePendingError('维护响应不完整，结果尚未确认，正在核实原任务。');
      setState(next);
      if (['service-remove-preview', 'service-uninstall'].includes(action) || awaiting.current && observesSubmission(awaiting.current, next.job)) { awaiting.current = null; setUncertain(false); }
    };
    try {
      const next = await desktopInvoke<Update>('axiom_update', { action, version: payload ? JSON.stringify(payload) : null }, 55_000);
      if (!next || !Object.hasOwn(next, 'job')) throw new DesktopResponsePendingError('维护状态不完整，结果尚未确认，正在核实清理任务。');
      accept(next);
      if (next.job?.kind === 'service-uninstall' && next.job.task && !next.job.running && rescanned.current !== next.job.task.id) {
        if (await rescan.current()) rescanned.current = next.job.task.id;
      }
    } catch (cause) {
      if (mounted.current) {
        const waiting = isDesktopResponsePending(cause);
        setNeutral(action === 'status' || waiting); setError(cause instanceof Error ? cause.message : String(cause));
        if (waiting && ['service-remove-preview', 'service-uninstall'].includes(action)) {
          awaiting.current = attempt; setUncertain(true);
          if (cause instanceof DesktopResponsePendingError && cause.response) void cause.response.then(value => {
            if (!mounted.current || awaiting.current !== attempt) return;
            try { accept(value as Update); } catch { setNeutral(true); setError('原请求响应不完整，结果尚未确认，正在核实原任务。'); }
          }, failure => {
            if (!mounted.current || awaiting.current !== attempt) return;
            const refused = isSubmissionRefused(failure);
            if (refused) { awaiting.current = null; setUncertain(false); intent.current = false; }
            setNeutral(!refused);
            setError(refused ? (failure instanceof Error ? failure.message : String(failure)) : '原请求结果尚未确认，正在核实，请勿重复提交。');
          });
        }
      }
    }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const needsReconciliation = !!job?.servicePending || ownJob && !job?.reconciled && (job?.task?.status === 'unknown' || job?.task?.status === 'interrupted');
  const watching = running && ownJob || uncertain || needsReconciliation;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => { void act('status'); }, 1500);
    return () => clearInterval(timer);
  }, [watching]);
  useEffect(() => { if (ready && intent.current) { intent.current = false; setConfirmed(preview!); setConsent(false); } }, [ready, preview]);
  async function remove() {
    if (!confirmed?.token || !consent || lock.current) return;
    const token = confirmed.token; setConfirmed(undefined); setConsent(false);
    setState(value => value?.serviceRemoval ? { ...value, serviceRemoval: { ...value.serviceRemoval, token: null } } : value);
    await act('service-uninstall', { token, confirm: true });
  }
  const items = job?.kind === 'service-uninstall' ? job.cleanup?.items : ready ? preview?.items : undefined;
  return <section className="environment-item" aria-label="托管后台卸载" hidden={installed === false && !ownJob}>
    <div className="environment-cleanup-row"><div><strong>后台服务 · 应用内 Pi</strong><p className="connect-update-detail">{windows ? '当前 Windows 版本暂不支持自动卸载' : '卸载后本机工作台会断开，项目和会话保留'}</p></div><button className="connect-secondary" disabled={windows || busy || running || uncertain || needsReconciliation || !!confirmed} onClick={() => void act('service-remove-preview')}>{busy || running ? '正在核对…' : uncertain ? '正在核实…' : '卸载'}</button></div>
    {error && <p className={neutral || running ? "connect-message" : "connect-error"} role={neutral || running ? "status" : "alert"}>{error}</p>}
    {state?.serviceRemovalPending && <p className="environment-issue">上次后台卸载尚未完成。请核实剩余范围后再继续卸载；完成前不能重新安装或更新后台。</p>}
    {ownJob && job.task && <MaintenanceTaskView task={job.task} compact connected onCancel={() => act('cancel', { id: job.task!.id })} onExtend={budgets => act('extend', { id: job.task!.id, budgets })} onReconcile={() => act('reconcile', { id: job.task!.id })} />}
    {confirmed && <div className="environment-confirm inline-confirmation" role="group" aria-label="确认后台卸载"><p>卸载后台服务 {confirmed.version}？</p><p>本机工作台会断开，运行中的任务会随后台停止。数据目录和独立工具保留，程序需要重新安装后才能使用。</p><details><summary>查看移除与保留范围</summary><p className="connect-log">{confirmed.packageRoot}</p><ul>{confirmed.items.map((item, index) => <li key={index}>{item.label} · {labels[item.state]}{item.path && <code>{item.path}</code>}{item.note && <p>{item.note}</p>}</li>)}</ul></details><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>我已保存工作，可以停止并卸载后台程序</span></label><div className="connect-actions"><button className="connect-secondary" disabled={busy} onClick={() => setConfirmed(undefined)}>取消</button><button className="connect-secondary confirm-danger" disabled={busy || !consent} onClick={() => void remove()}>确认卸载后台</button></div></div>}
    {job?.kind === 'service-uninstall' && items && <details><summary>查看卸载结果</summary><ul>{items.map((item, index) => <li key={index}>{item.label} · {labels[item.state]}{item.note && <p>{item.note}</p>}{item.path && <code>{item.path}</code>}</li>)}</ul></details>}
    {job?.kind === 'service-uninstall' && job.cleanup && <p className="connect-update-detail">{job.cleanup.complete ? '后台程序已卸载，项目与会话已保留。' : '卸载结果仍需核实，请勿重复提交。'}</p>}
  </section>;
}
