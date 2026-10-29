import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Icons } from "../../src/client/components.js";
import { TooltipLayer } from "../../src/client/TooltipLayer.js";
import { LocalPath } from "../../src/client/LocalPath.js";
import { MaintenanceTaskView } from "../../src/client/maintenance/MaintenanceView.js";
import { ComponentAction, ComponentActions, ComponentCard, ComponentConfirmation } from "../../src/client/maintenance/ComponentCard.js";
import { defaultMaintenanceBudgets, maintenanceActive, type MaintenanceTask } from "../../src/shared/maintenance.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/builtin-tools.css";
import "../../src/client/styles/theme.css";

const now = Date.now();
const sample: MaintenanceTask = { id: "fixture-download", attemptId: "fixture-attempt", resource: "fixture", label: "示例程序", action: "install", endpoint: "backend", scope: "应用级", status: "running", phase: "downloading", steps: ["checking", "downloading", "verifying", "installing", "validating"], completedSteps: 1, createdAt: now - 36000, startedAt: now - 36000, updatedAt: now, budgets: defaultMaintenanceBudgets, capabilities: { cancel: true, extend: true }, transfer: { received: 6_291_456, total: 12_582_912, bytesPerSecond: 1_048_576, updatedAt: now, source: "https://example.invalid/releases/fixture-very-long-download-source", connection: "receiving" } };
const samples: Record<string, MaintenanceTask> = {
  idle: { ...sample, status: "succeeded", capabilities: { cancel: false, extend: false } },
  download: sample, downloading: sample,
  queued: { ...sample, phase: "queued", transfer: undefined, startedAt: undefined, completedSteps: 0 },
  checking: { ...sample, phase: "checking", completedSteps: 0 },
  verifying: { ...sample, phase: "verifying", completedSteps: 2 },
  removing: { ...sample, phase: "removing", completedSteps: 0 },
  "download-no-transfer": { ...sample, transfer: undefined },
  ...Object.fromEntries((["queued", "checking", "downloading", "verifying", "installing", "validating", "removing"] as const).map(phase => [`cancelling-${phase}`, { ...sample, phase, status: "cancelling" as const, transfer: phase === "downloading" ? sample.transfer : undefined }])),
  ...Object.fromEntries((["connecting", "receiving", "waiting", "retrying", "finished"] as const).map(connection => [`${connection}-unknown`, { ...sample, transfer: { ...sample.transfer!, total: undefined, updatedAt: Date.now(), connection } }])),
  installing: { ...sample, id: "fixture-installing", phase: "installing", completedSteps: 3, transfer: { ...sample.transfer!, received: sample.transfer!.total!, connection: "finished" } },
  validating: { ...sample, id: "fixture-validating", phase: "validating", completedSteps: 4 },
  waiting: { ...sample, id: "fixture-waiting", phase: "queued", startedAt: undefined, transfer: undefined, completedSteps: 0, message: "正在等待当前执行结束；空闲后自动开始安装。" },
  failure: { ...sample, id: "fixture-failed", status: "failed", finishedAt: now, capabilities: { cancel: false, extend: false }, error: { code: "idle-timeout", phase: "downloading", message: "下载源连续 60 秒没有返回数据，可调整等待时限后重试。" } },
  success: { ...sample, id: "fixture-success", status: "succeeded", finishedAt: now, phase: "validating", completedSteps: 5, capabilities: { cancel: false, extend: false }, message: "程序与专属环境已验证并切换。" },
  unknown: { ...sample, id: "fixture-unknown", status: "unknown", capabilities: { cancel: false, extend: false }, message: "尚不能证明维护进程已经退出。" },
  interrupted: { ...sample, id: "fixture-interrupted", status: "interrupted", capabilities: { cancel: false, extend: false } },
  uncancellable: { ...sample, id: "fixture-removing", phase: "removing", capabilities: { cancel: false, extend: false } },
};
function Fixture() {
  const [kind, setKind] = useState("download"), [task, setTask] = useState(sample);
  const [environment, setEnvironment] = useState(true), [connected, setConnected] = useState(true), [reject, setReject] = useState(false);
  const [compact, setCompact] = useState(false), [hideTaskError, setHideTaskError] = useState(false), [mixed, setMixed] = useState(false), [longHeader, setLongHeader] = useState(false);
  const [confirm, setConfirm] = useState<"remove" | "repair">(), [requests, setRequests] = useState(0), [feedback, setFeedback] = useState("");
  const [pathRequests, setPathRequests] = useState(0);
  const fixturePath = longHeader ? `/fixture/${"a-long-private-installation-directory/".repeat(8)}program` : "/fixture/program";
  const active = maintenanceActive(task);
  const control = async () => { setRequests(value => value + 1); if (reject) throw Error("模拟控制失败，原记录与文件保持不变。"); };
  const confirmation = confirm && <ComponentConfirmation key={confirm} title={confirm === "remove" ? "卸载示例程序？" : "修复独立环境？"} description={confirm === "remove" ? "移除此程序及其专属环境；设置、使用记录和其他程序保留。" : "仅修复本程序的专属环境，不修改系统运行时或其他程序。"} danger confirmLabel={confirm === "remove" ? "确认卸载" : "确认修复"} onClose={() => setConfirm(undefined)} onConfirm={async () => { await control(); setFeedback(confirm === "remove" ? "已移除示例程序及专属环境。" : "专属环境修复完成。"); }} />;
  return <><Icons /><TooltipLayer /><main style={{ width: "min(100%, 860px)", margin: "0 auto", padding: "28px 18px" }}>
    <header style={{ marginBottom: 28 }}><p className="meta">AXIOM / 单程序卡片</p><h1 style={{ fontSize: 24 }}>组件管理</h1><p className="meta">全部为模拟数据和内存操作，不连接维护执行器。</p></header>
    <label className="meta">测试状态 <select aria-label="测试状态" value={kind} onChange={event => { setKind(event.target.value); setTask(samples[event.target.value]); setConfirm(undefined); setFeedback(""); }}>{Object.keys(samples).map(value => <option key={value}>{value}</option>)}</select></label>
    <div className="tools-actions"><label><input type="checkbox" aria-label="提供独立环境" checked={environment} onChange={event => setEnvironment(event.target.checked)} />提供独立环境</label><label><input type="checkbox" aria-label="保持连接" checked={connected} onChange={event => setConnected(event.target.checked)} />保持连接</label><label><input type="checkbox" aria-label="模拟控制失败" checked={reject} onChange={event => setReject(event.target.checked)} />模拟控制失败</label></div>
    <div className="tools-actions"><label><input type="checkbox" aria-label="紧凑视图" checked={compact} onChange={event => setCompact(event.target.checked)} />紧凑视图</label><label><input type="checkbox" aria-label="隐藏重复任务错误" checked={hideTaskError} onChange={event => setHideTaskError(event.target.checked)} />隐藏重复任务错误</label></div>
    <label><input type="checkbox" aria-label="保留旧未决" checked={mixed} onChange={event => setMixed(event.target.checked)} />保留旧未决</label>
    <label><input type="checkbox" aria-label="超长头部" checked={longHeader} onChange={event => setLongHeader(event.target.checked)} />超长头部</label>
    <output aria-label="请求计数">{requests}</output><output aria-label="路径打开计数">{pathRequests}</output>
    <ComponentCard regionLabel="示例程序维护" label={longHeader ? "示例程序（用于验证完整名称和省略的超长组件标题）" : "示例程序"} description="可嵌入任意页面的程序管理单元" version={longHeader ? "v1.0.0-private-channel-with-a-very-long-build-identifier-20261028" : "v1.0.0"}
      actions={<ComponentActions context={{ connected, taskRunning: active }} capabilities={[
        { id: "check-install", label: "检查安装", conflictsWithTask: true, execute: () => setFeedback("已读取安装状态。未提交安装。") },
        { id: "update", label: "更新至 v1.0.1", primary: true, conflictsWithTask: true, execute: () => { setRequests(value => value + 1); setKind("download"); setTask(sample); } },
        { id: "uninstall", label: "卸载程序", danger: true, conflictsWithTask: true, execute: () => setConfirm("remove") },
      ]} />}
      availableVersion={longHeader ? "v1.0.1-candidate-with-a-very-long-prerelease-and-build-identifier-20261028" : "v1.0.1"} availableVersionLabel="最新" location={<LocalPath path={fixturePath} onOpen={async () => setPathRequests(value => value + 1)} />}
      details={<p>由原安装器在原位置维护。</p>}
      environment={environment ? [
        { id: "node", kind: "environment", label: "Node.js", version: "24.15.0", description: "测试专属运行时，不表示当前机器的实际安装。", location: <LocalPath path="/fixture/long-private-program-environment-directory/runtime/node" onOpen={async () => setPathRequests(value => value + 1)} />, details: <p>原安装器整体维护，不单独改系统环境。</p>, actions: <ComponentAction icon="wrench" label="修复环境" disabled={active} onClick={() => setConfirm("repair")} />, children: confirm === "repair" && confirmation },
        { id: "npm", kind: "environment", label: "npm", version: "11", description: "测试包管理器，与 Node.js 并列展示。", details: <p>随专属运行时分发；npm 依赖 Node.js，并非 Node.js 的依赖。</p> },
        { id: "library", kind: "dependency", label: "辅助依赖", description: "通用组件仍支持递归，展示包含与安装归属分离。", environment: [{ id: "platform", kind: "environment", label: "底层环境", version: "1", description: "测试递归能力，不代表 Node/npm 的依赖关系。" }] },
      ] : undefined}
      feedback={feedback && <p role="status">{feedback}</p>}
      maintenance={<>{kind !== "idle" && <MaintenanceTaskView key={task.id} task={task} connected={connected} compact={compact} showError={!hideTaskError} hasUnresolved={mixed}
        onCancel={async () => { await control(); setTask(value => ({ ...value, status: "cancelled", finishedAt: Date.now(), capabilities: { cancel: false, extend: false } })); }}
        onExtend={async budgets => { await control(); setTask(value => ({ ...value, budgets })); }}
        onReconcile={async () => { await control(); setFeedback("已请求原位核实，未重复安装。"); }} />}{mixed && <div className="component-unresolved">{[samples.unknown, samples.interrupted].map(old => <MaintenanceTaskView key={old.id} task={old} connected={connected} />)}</div>}</>}>
      {confirm === "remove" && confirmation}
    </ComponentCard>
    <ComponentCard label="原生程序" description="直接使用系统程序，无独立运行环境" version="未安装" />
  </main></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
