import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { ConfirmDialog } from "../../src/client/ConfirmDialog.js";
import { Icons } from "../../src/client/components.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/display-settings.css";
import "../../src/client/styles/page-overrides.css";

type Kind = "delete" | "normal" | "long" | "secondary" | "async" | "chain" | "chain-next";
declare global { interface Window { confirmationTest: { resolve?: () => void; reject?: () => void } } }
window.confirmationTest = {};
function Fixture() {
  const [modal, setModal] = useState<{ kind: Kind } | null>(null);
  const [consent, setConsent] = useState(false);
  const [attempts, setAttempts] = useState(0), [commits, setCommits] = useState(0), [secondary, setSecondary] = useState(0);
  const backgroundClicks = useRef(0);
  const close = () => setModal(current => current === modal ? null : current);
  const confirm = () => {
    if (modal?.kind === "chain") { setModal({ kind: "chain-next" }); return; }
    if (modal?.kind === "async") {
      setAttempts(value => value + 1);
      return new Promise<void>((resolve, reject) => {
        window.confirmationTest = {
          resolve: () => { setCommits(value => value + 1); resolve(); },
          reject: () => reject(Error("删除失败，请检查连接后重试。")),
        };
      });
    }
    setCommits(value => value + 1);
  };
  const kind = modal?.kind;
  return <><Icons /><main style={{ width: "min(920px, 100%)", margin: "0 auto", padding: 28 }}>
    <p className="meta">AXIOM / 确认操作</p><h1 style={{ fontSize: 24 }}>项目与模型配置</h1>
    <p style={{ marginTop: 12, color: "var(--muted)" }}>隔离的界面回归数据，不会删除文件或更改应用配置。</p>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>{(["delete", "normal", "long", "secondary", "async", "chain"] as const).map(kind =>
      <button key={kind} className="btn" data-trigger={kind} onClick={() => { setConsent(false); setModal({ kind }); }}>{kind}</button>)}</div>
    <button className="btn" style={{ marginTop: 20 }} onClick={() => { backgroundClicks.current++; }}>背景操作</button>
    <output data-testid="counts" data-attempts={attempts} data-commits={commits} data-secondary={secondary} />
    {modal && <ConfirmDialog key={kind} title={kind === "chain" ? "停止受影响的执行？" : kind === "chain-next" ? "删除供应商？" : kind === "secondary" ? "创建分支会话" : kind === "normal" ? "允许页面联网？" : kind === "long" ? "卸载资源并清理残留？" : "删除模型草稿？"}
      subject={kind === "delete" ? "Claude Sonnet 4.5\nclaude-sonnet-4-5-20250929" : undefined}
      description={kind === "normal" ? "允许页面访问互联网、本机及内网。页面可能向这些地址发送数据，跨域仍受 CORS 限制。" : kind === "secondary" ? "将从当前节点创建独立的分支会话，原会话与项目文件不会改变。" : kind === "long" ? <><p>仅清理此项目下列出的资源，其他项目、历史会话和个人设置会保留。</p><ul>{Array.from({ length: 32 }, (_, index) => <li key={index}>C:\\项目\\非常长的资源目录名称\\{index}\\{"nested-resource-".repeat(8)}SKILL.md</li>)}</ul><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />我已核对清理范围</label></> : kind === "chain" ? "正在执行的任务将被停止，项目文件不会回滚。" : kind === "chain-next" ? "将删除所选供应商，其他供应商和项目记录保留。" : "将此模型移出本页草稿，保存后才会生效。"}
      warning={kind === "delete" ? "移除前请核对模型名称与 ID；其他模型与供应商授权保持不变。" : undefined}
      danger={kind !== "normal" && kind !== "secondary"} confirmDisabled={kind === "long" && !consent}
      confirmLabel={kind === "normal" ? "允许联网" : kind === "secondary" ? "创建并打开" : kind === "long" ? "卸载资源" : kind === "chain" ? "停止并继续" : kind === "chain-next" ? "删除供应商" : "删除草稿"}
      secondaryAction={kind === "secondary" ? { label: "仅创建", onConfirm: () => { setSecondary(value => value + 1); } } : undefined}
      onConfirm={confirm} onClose={close} />}
  </main></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
