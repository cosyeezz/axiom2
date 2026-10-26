import "./popover-compat.js";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialog } from "../../src/client/ConfirmDialog.js";
import { ProcessIcon } from "../../src/client/chat/ProcessIcon.js";
import { Icons } from "../../src/client/components.js";
import "../../src/client/styles/icon-geometry.css";
import { CodeBlock } from "../../src/client/chat/CodeBlock.js";
import { initializeTheme, setTheme, ThemeToggle } from "../../src/client/theme.js";
import "../../src/client/styles/thinking.css";
import "../../src/client/styles/skill-cards.css";
import "../../src/client/styles/theme.css";

initializeTheme();
const sample = document.createElement("section");
sample.style.cssText = "position:absolute;top:70px;left:24px;right:24px;max-width:680px";
document.body.append(sample);
function Samples() {
  const [confirm, setConfirm] = useState(false);
  return <><Icons /><div className="row-between"><h2>昼夜主题 · 阅读与浮层</h2><ThemeToggle /></div>
    <div className="log-row"><div className="message-body markdown"><p>正文与辅助信息应保持清晰，弹窗和下拉菜单沿用同一套配色。</p>
      <CodeBlock language="typescript" text={'// 配套主题\nconst theme = "light";\nconst readable = true;'} /></div></div>
    <div className="thinking-block"><ProcessIcon kind="think" /><div className="thinking-body markdown">正在检查文字、边框与状态反馈…</div></div>
    <div style={{ position: "relative", height: 28 }}><div className="activity-current" data-status="failed"><ProcessIcon kind="tool" />操作失败</div></div>
    <div className="skill-card"><div className="skill-card-copy"><strong>技能与 MCP</strong><span>可用能力与运行状态</span></div></div>
    <button className="btn" onClick={() => setConfirm(true)}>打开确认弹窗</button>
    {confirm && <ConfirmDialog title="删除测试项目？" description="仅用于检查弹窗主题和危险操作的对比度。" subject="主题检查" danger confirmLabel="确认删除" onConfirm={async () => { throw Error("测试错误提示"); }} onClose={() => setConfirm(false)} />}
  </>;
}
createRoot(sample).render(<Samples />);
Object.assign(window, { setFixtureTheme: setTheme });
