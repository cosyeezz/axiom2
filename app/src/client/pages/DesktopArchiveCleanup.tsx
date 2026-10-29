import { useEffect, useRef, useState } from 'react';
import { MaintenanceTaskView } from '../maintenance/MaintenanceView.js';
import { ComponentAction, ComponentCard, ComponentConfirmation } from '../maintenance/ComponentCard.js';
import type { MaintenanceTask } from '../../shared/maintenance.js';
import { desktopInvoke, DesktopResponsePendingError, isDesktopResponsePending } from './desktop-bridge.js';
import { observesSubmission, isSubmissionRefused, validOperationJob, type OperationWitness } from './desktop-operation.js';
type Item = { id?: string; label: string; path?: string; note?: string; size?: number; state: 'remove' | 'retain' | 'unverified' | 'removed' | 'remaining' };
type Preview = { token: string | null; items: Item[] };
type Update = { archiveCleanup?: Preview; job: { kind: string; running: boolean; reconciled?: boolean; servicePending?: boolean; task?: MaintenanceTask; cleanup?: { complete: boolean; items: Item[] } } | null };
const labels = { remove: '可清理', retain: '保留', unverified: '未核实', removed: '已移除', remaining: '仍有残留' };
export default function DesktopArchiveCleanup({ onRescan }: { onRescan: () => Promise<boolean> }) {
  const [state, setState] = useState<Update>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<{ token: string; item: Item }>();
  const [uncertain, setUncertain] = useState(false), [neutral, setNeutral] = useState(false);
  const awaiting = useRef<OperationWitness | null>(null), intent = useRef(false);
  const lock = useRef(false), mounted = useRef(true), rescanned = useRef(''), rescan = useRef(onRescan); rescan.current = onRescan;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const job = state?.job, running = !!job?.running;
  const own = job?.kind === 'archive-preview' || job?.kind === 'archive-remove';
  const ready = !busy && !uncertain && !error && !running && job?.kind === 'archive-preview' && job.task?.status === 'succeeded' && !!state?.archiveCleanup?.token;
  async function act(action: string, payload?: unknown) {
    if (lock.current || awaiting.current && ['archive-preview', 'archive-remove'].includes(action)) return;
    lock.current = true; setBusy(true); setError('');
    if (action === 'archive-preview') { intent.current = true; setConfirmation(undefined); }
    const attempt = { action, previousId: state?.job?.task?.id, sentAt: Date.now() };
    const accept = (next: Update) => {
      if (!mounted.current) return;
      if (!next || !Object.hasOwn(next, 'job') || next.job !== null && !validOperationJob(next.job) || ['archive-preview', 'archive-remove'].includes(action) && next.job?.kind !== action) throw new DesktopResponsePendingError('维护响应不完整，结果尚未确认，正在核实原任务。');
      setState(next);
      if (['archive-preview', 'archive-remove'].includes(action) || awaiting.current && observesSubmission(awaiting.current, next.job)) { awaiting.current = null; setUncertain(false); }
    };
    try {
      const next = await desktopInvoke<Update>('axiom_update', { action, version: payload ? JSON.stringify(payload) : null }, 55_000);
      if (!next || !Object.hasOwn(next, 'job')) throw new DesktopResponsePendingError('维护状态不完整，结果尚未确认，正在核实清理任务。');
      accept(next);
      if (next.job?.kind === 'archive-remove' && !next.job.running && next.job.task && rescanned.current !== next.job.task.id) {
        if (await rescan.current()) rescanned.current = next.job.task.id;
      }
    } catch (cause) {
      if (mounted.current) {
        const waiting = isDesktopResponsePending(cause);
        setNeutral(action === 'status' || waiting); setError(cause instanceof Error ? cause.message : String(cause));
        if (waiting && ['archive-preview', 'archive-remove'].includes(action)) {
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
      if (action === 'archive-remove') await rescan.current();
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const needsReconciliation = !!job?.servicePending || own && !job?.reconciled && (job?.task?.status === 'unknown' || job?.task?.status === 'interrupted');
  const watching = running && own || uncertain || needsReconciliation;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void act('status'), 1500); return () => clearInterval(timer);
  }, [watching]);
  useEffect(() => {
    if (!ready || !intent.current) return;
    intent.current = false;
    const removable = state?.archiveCleanup?.items.filter(item => item.id && item.state === 'remove');
    if (removable?.length === 1) setConfirmation({ token: state!.archiveCleanup!.token!, item: removable[0] });
  }, [ready, state?.archiveCleanup]);
  async function remove() {
    if (!confirmation?.item.id || lock.current) return;
    const selected = confirmation; setConfirmation(undefined);
    setState(value => value?.archiveCleanup ? { ...value, archiveCleanup: { ...value.archiveCleanup, token: null } } : value);
    await act('archive-remove', { token: selected.token, id: selected.item.id, confirm: true });
  }
  const items = job?.kind === 'archive-remove' ? job.cleanup?.items : ready ? state?.archiveCleanup?.items : undefined;
  if (/Win/i.test(navigator.platform)) return null;
  return <ComponentCard className="environment-component" regionLabel="下载归档清理" label="后台下载包" description="清理后，再次更新时需要重新下载" busy={busy || running || uncertain}
    actions={<ComponentAction icon="trash-2" label="清理" danger disabled={busy || running || uncertain || needsReconciliation || !!confirmation} disabledReason="维护正在进行或结果待核实，请先完成当前操作。" onClick={() => void act('archive-preview')} />}>
    {error && <p className={neutral || running ? 'connect-message' : 'connect-error'} role={neutral || running ? 'status' : 'alert'}>{error}</p>}
    {own && job.task && <MaintenanceTaskView task={job.task} compact connected onCancel={() => act('cancel', { id: job.task!.id })} onExtend={budgets => act('extend', { id: job.task!.id, budgets })} onReconcile={() => act('reconcile', { id: job.task!.id })} />}
    {items && <ul className="environment-locations">{items.map((item, index) => <li key={item.id ?? index}><div className="environment-location-title"><span>{item.label}</span><span>{labels[item.state]}</span></div>{item.size != null && <span>{(item.size / 1024 / 1024).toFixed(2)} MiB</span>}{ready && item.id && item.state === 'remove' && <ComponentAction icon="trash-2" label={`清理 ${item.label}`} danger disabled={busy || !!confirmation} onClick={() => setConfirmation({ token: state!.archiveCleanup!.token!, item })} />}</li>)}</ul>}
    {ready && !items?.some(item => item.state === 'remove') && <p className="connect-update-detail">本次未发现可直接清理的下载归档；这不代表其他安装空间没有残留。</p>}
    {confirmation && <ComponentConfirmation title="确认归档清理" danger confirmLabel="确认清理" confirmDisabled={busy || running || uncertain || needsReconciliation}
      description={<><p>确认删除下载包：{confirmation.item.label}</p><p>程序、用户数据和维护记录保留。</p></>} onClose={() => setConfirmation(undefined)} onConfirm={remove}>
      {confirmation.item.note && <p>{confirmation.item.note}</p>}
      <details><summary>查看清理位置</summary><p className="connect-log">{confirmation.item.path}</p></details>
    </ComponentConfirmation>}
    {job?.kind === 'archive-remove' && job.cleanup && <p className="connect-update-detail">{job.cleanup.complete ? '所选下载归档路径已移除。' : '归档清理结果仍需核实。'}</p>}
  </ComponentCard>;
}
