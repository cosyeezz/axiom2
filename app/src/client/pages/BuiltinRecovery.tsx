import { Icon } from "../Icon.js";

/** Forced recovery is opt-in and never replays the interrupted operation. */
export function BuiltinRecovery({ label, operationId, disabled, reconcile }: { label: string; operationId: string; disabled: boolean; reconcile: (force: boolean) => void }) {
  return <div className="tools-conflict" role="group" aria-label={`核实 ${label} 中断任务`}>
    <p>上次维护尚未收尾。再次安装或卸载时会先自动核实；也可单独核实，保留现有文件。</p>
    <button className="btn" disabled={disabled} onClick={() => reconcile(false)}><Icon name="refresh-cw" />核实中断任务</button>
    <details key={operationId}>
      <summary>维护进程仍未退出？</summary>
      <p>仅停止可证明属于此次中断维护的进程树，再核实收尾。不停止无关程序，不删除安装文件，也不重新执行旧操作；无法确认归属时保留现场。</p>
      <button className="btn" disabled={disabled} onClick={() => reconcile(true)}>确认受控停止并核实</button>
    </details>
  </div>;
}
