import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Icons, Icon } from "../../src/client/components.js";
import { MaintenancePanel, BudgetEditor } from "../../src/client/maintenance/MaintenanceView.js";
import { TaskCenterContent } from "../../src/client/maintenance/BackendMaintenance.js";
import { defaultMaintenanceBudgets, type MaintenanceTask } from "../../src/shared/maintenance.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/builtin-tools.css";
import "../../src/client/styles/theme.css";

const now = Date.now();
const sample: MaintenanceTask = { id: "fixture-download", attemptId: "fixture-attempt", resource: "rtk", label: "RTK", action: "install", endpoint: "backend", scope: "应用级", status: "running", phase: "downloading", steps: ["checking", "downloading", "verifying", "installing", "validating"], completedSteps: 1, createdAt: now - 36000, startedAt: now - 36000, updatedAt: now, budgets: defaultMaintenanceBudgets, capabilities: { cancel: true, extend: true }, transfer: { received: 6_291_456, total: 12_582_912, bytesPerSecond: 1_048_576, updatedAt: now, source: "https://github.com", connection: "receiving" } };
const samples: Record<string, MaintenanceTask> = {
  download: sample,
  waiting: { ...sample, id: "fixture-waiting", resource: "opencli", label: "OpenCLI", phase: "queued", startedAt: undefined, transfer: undefined, completedSteps: 0, message: "正在等待当前 OpenCLI 执行结束；空闲后自动开始安装。" },
  failure: { ...sample, id: "fixture-failed", status: "failed", finishedAt: now, capabilities: { cancel: false, extend: false }, error: { code: "idle-timeout", phase: "downloading", message: "下载源连续 60 秒没有返回数据，可调整等待时限后重试。" } },
  success: { ...sample, id: "fixture-success", label: "字体 · Inter", resource: "font:inter", endpoint: "browser", status: "succeeded", finishedAt: now, phase: "validating", completedSteps: 5, capabilities: { cancel: false, extend: false }, message: "字体已保存，可离线使用。" },
};
function Fixture() {
  const [kind, setKind] = useState("download"), [task, setTask] = useState(sample), [open, setOpen] = useState(false);
  const extend = async (_task: MaintenanceTask, budgets: typeof defaultMaintenanceBudgets) => { setTask(value => ({ ...value, budgets })); };
  const cancel = async () => setTask(value => ({ ...value, status: "cancelled", finishedAt: Date.now(), capabilities: { cancel: false, extend: false } }));
  return <><Icons /><main style={{ width: "min(100%, 860px)", margin: "0 auto", padding: "28px 18px" }}>
    <header style={{ marginBottom: 28 }}><p className="meta">AXIOM / 内置工具</p><h1 style={{ fontSize: 24 }}>工具与资源</h1><p className="meta" style={{ marginTop: 7 }}>界面回归数据 · 下载与维护组件</p></header>
    <label className="meta">测试状态 <select aria-label="测试状态" value={kind} onChange={e => { setKind(e.target.value); setTask(samples[e.target.value]); }}>{Object.keys(samples).map(value => <option key={value}>{value}</option>)}</select></label>
    <div style={{ marginTop: 22 }}><MaintenancePanel label={task.label} location="所连接后台 · 应用级 · Axiom 独立管理" task={task} onOpenTasks={() => setOpen(true)} onCancel={cancel} onExtend={budgets => extend(task, budgets)}>
      <dl className="tools-facts"><div><dt>当前版本</dt><dd>v1.0.0</dd></div><div><dt>可用版本</dt><dd>v1.0.1</dd></div><div><dt>安装位置</dt><dd>后台电脑</dd></div></dl>
      <div className="tools-actions"><button className="btn"><Icon name="refresh-cw" />检查更新</button><button className="btn btn-primary" disabled={task.status === "running"}><Icon name="download" />更新至 v1.0.1</button></div>
      <p className="field-help tools-help">校验并自检通过后切换版本。设置与使用记录会保留。</p>
    </MaintenancePanel></div>
    {open && <TaskCenterContent tasks={[...Object.values(samples).filter(item => item.id !== task.id && item.id !== sample.id), task]} connected onClose={() => setOpen(false)} onCancel={cancel} onExtend={extend}><details className="maintenance-details"><summary><Icon name="server" /><span>后台下载设置</span><Icon name="chevron-down" /></summary><BudgetEditor value={task.budgets} onSave={budgets => extend(task, budgets)} /></details></TaskCenterContent>}
  </main></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
