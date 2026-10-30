import { useEffect, useRef, useState } from 'react';
import { MaintenanceTaskView } from '../maintenance/MaintenanceView.js';
import { ComponentAction, ComponentCard, ComponentConfirmation } from '../maintenance/ComponentCard.js';
import type { MaintenanceTask } from '../../shared/maintenance.js';
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from './desktop-bridge.js';
import { observesSubmission, isSubmissionRefused, validOperationJob, type OperationWitness } from './desktop-operation.js';

type Item = { label: string; path?: string; state: 'remove' | 'retain' | 'unverified' | 'removed' | 'remaining' | 'absent'; note?: string };
type Preview = { token: string | null; installed?: boolean; version: string | null; packageRoot: string; message?: string; items: Item[] };
type Update = { pi?: { removal?: Preview | null }; job: { kind: string; running: boolean; reconciled?: boolean; servicePending?: boolean; message: string; task?: MaintenanceTask; cleanup?: { items: Item[]; complete: boolean } } | null };
const labels = { remove: '将移除', retain: '保留', unverified: '未核实', removed: '已移除', remaining: '仍有残留', absent: '未发现' };
async function invoke(action: string, payload?: unknown) {
  const value = await desktopInvoke<Update>('axiom_update', { action, version: payload ? JSON.stringify(payload) : null }, 55_000);
  if (!value || !Object.hasOwn(value, 'job')) throw new DesktopResponsePendingError('维护状态不完整，结果尚未确认，正在核实清理任务。');
  return value;
}
export default function DesktopPiRemoval({ onRescan }: { onRescan: () => Promise<boolean> }) {
  const [state, setState] = useState<Update | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false), [neutral, setNeutral] = useState(false);
  const awaiting = useRef<OperationWitness | null>(null), intent = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [closed, setClosed] = useState(false);
  const [confirmed, setConfirmed] = useState<Preview | null>(null);
  const pending = useRef(false), rescanned = useRef('');
  const rescan = useRef(onRescan); rescan.current = onRescan;
  const job = state?.job;
  const ownJob = job?.kind === 'pi-uninstall' || job?.kind === 'pi-remove-preview';
  const running = !!job?.running;
  const preview = state?.pi?.removal;
  const checked = !busy && !uncertain && !error && !running && job?.kind === 'pi-remove-preview' && job.task?.status === 'succeeded' && preview && Array.isArray(preview.items);
  const ready = checked && preview.installed !== false && preview.token;
  async function act(action: string, payload?: unknown) {
    if (pending.current || awaiting.current && ['pi-remove-preview', 'pi-uninstall'].includes(action)) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    if (action === 'pi-remove-preview') { intent.current = true; setConfirmed(null); setClosed(false); }
    const attempt = { action, previousId: state?.job?.task?.id, sentAt: Date.now() };
    const accept = (next: Update) => {
      if (!mounted.current) return;
      if (!next || !Object.hasOwn(next, 'job') || next.job !== null && !validOperationJob(next.job) || ['pi-remove-preview', 'pi-uninstall'].includes(action) && next.job?.kind !== action) throw new DesktopResponsePendingError('维护响应不完整，结果尚未确认，正在核实原任务。');
      setState(next);
      if (['pi-remove-preview', 'pi-uninstall'].includes(action) || awaiting.current && observesSubmission(awaiting.current, next.job)) { awaiting.current = null; setUncertain(false); }
    };
    try {
      const next = await invoke(action, payload); accept(next);
      if (action === 'status' && !['pi-uninstall', 'pi-remove-preview'].includes(next.job?.kind ?? '') && !awaiting.current) setNotice('终端 Pi 状态尚未核实。');
      if (next.job?.kind === 'pi-uninstall' && next.job.task && !next.job.running && !['running', 'cancelling', 'unknown'].includes(next.job.task.status) && rescanned.current !== next.job.task.id) {
        if (await rescan.current()) rescanned.current = next.job.task.id;
      }
    } catch (cause) {
      const waiting = isDesktopResponsePending(cause);
      setNeutral(action === 'status' || waiting); setError(cause instanceof Error ? cause.message : String(cause));
      if (waiting && ['pi-remove-preview', 'pi-uninstall'].includes(action)) {
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
    finally { pending.current = false; setBusy(false); }
  }
  const needsReconciliation = !!job?.servicePending || ownJob && !job?.reconciled && (job?.task?.status === 'unknown' || job?.task?.status === 'interrupted');
  const watching = running && ownJob || uncertain || needsReconciliation;
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => { void act('status'); }, 2000);
    return () => window.clearInterval(timer);
  }, [watching]);
  useEffect(() => { if (ready && intent.current) { intent.current = false; setConfirmed(preview!); setClosed(false); } }, [ready, preview]);
  async function remove() {
    if (!confirmed?.token || !closed || pending.current) return;
    const token = confirmed.token;
    setConfirmed(null); setClosed(false);
    // The UI consumes its confirmation before sending; timeout does not authorize retry.
    setState(value => value?.pi?.removal ? { ...value, pi: { ...value.pi, removal: { ...value.pi.removal, token: null } } } : value);
    await act('pi-uninstall', { token, confirm: true, sessionsClosed: true });
  }
  const items = ownJob && job?.kind === 'pi-uninstall' ? job.cleanup?.items : checked ? preview.items : undefined;
  return <ComponentCard className="environment-component" regionLabel="终端 Pi 卸载" label="终端 Pi" description="独立的终端程序，卸载时保留个人设置" busy={busy || running || uncertain}
    version={preview?.version ? `v${preview.version}` : undefined} location={preview?.packageRoot}
    actions={<ComponentAction icon="trash-2" label="卸载" danger disabled={busy || running || uncertain || needsReconciliation || !!confirmed} disabledReason="维护正在进行或结果待核实，请先完成当前操作。" onClick={() => void act('pi-remove-preview')} />}>
    {error && <p className={neutral || running ? "connect-message" : "connect-error"} role={neutral || running ? "status" : "alert"}>{error}</p>}
    {notice && <p className="connect-update-detail" role="status">{notice}</p>}
    {checked && preview.installed === false && <p className="connect-update-detail" role="status">{preview.message || '所选 npm 中未安装终端 Pi，无需卸载；此结果不代表其他命令来源也未安装。'}</p>}
    {ownJob && job.task && !confirmed && <MaintenanceTaskView task={job.task} compact connected onCancel={() => act('cancel', { id: job.task!.id })} onReconcile={() => act('reconcile', { id: job.task!.id })} />}
    {confirmed && <ComponentConfirmation title="确认 Pi 卸载" danger confirmLabel="确认卸载" confirmDisabled={busy || uncertain || running || needsReconciliation || !closed}
      description={<><p>卸载终端 Pi {confirmed.version}？</p><p>程序和 npm 命令入口将被移除，设置及共享缓存保留。外部终端任务不会自动结束。</p></>}
      onClose={() => { setConfirmed(null); setClosed(false); }} onConfirm={remove}>
      {confirmed.items.some(item => item.state === 'unverified') && <p className="connect-message">部分项目归属未核实，将保留，不会删除。</p>}
      <details><summary>查看移除与保留范围</summary><p className="connect-log">{confirmed.packageRoot}</p><ul>{confirmed.items.map((item, index) => <li key={index}>{item.label} · {labels[item.state]}{item.path && <code>{item.path}</code>}{item.note && <p>{item.note}</p>}</li>)}</ul></details>
      <label><input type="checkbox" checked={closed} onChange={event => setClosed(event.target.checked)} /><span>我已关闭使用此安装的终端会话，可以卸载</span></label>
    </ComponentConfirmation>}
    {job?.kind === 'pi-uninstall' && items && <details><summary>查看卸载结果</summary><ul>{items.map((item, index) => <li key={index}>{item.label} · {labels[item.state]}{item.note && <p>{item.note}</p>}{item.path && <code>{item.path}</code>}</li>)}</ul></details>}
    {job?.kind === 'pi-uninstall' && job.cleanup && <p className="connect-update-detail">{job.cleanup.complete ? '终端 Pi 已卸载，个人设置已保留。' : '卸载结果仍需核实，请勿重复提交。'}</p>}
  </ComponentCard>;
}
