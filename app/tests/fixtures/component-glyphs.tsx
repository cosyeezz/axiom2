import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Icons } from "../../src/client/components.js";
import { TooltipLayer } from "../../src/client/TooltipLayer.js";
import { ComponentAction, ComponentActions, ComponentCard } from "../../src/client/maintenance/ComponentCard.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/icon-geometry.css";
import "../../src/client/styles/builtin-tools.css";
import "../../src/client/styles/theme.css";

function Fixture() {
  const [clicks, setClicks] = useState(0), [blockedClicks, setBlockedClicks] = useState(0);
  return <><Icons /><TooltipLayer /><main style={{ width: "min(100%, 760px)", margin: "0 auto", padding: "24px 18px" }}>
    <p className="meta">图标校准预览 · 数据与操作均为模拟</p>
    <ComponentCard label="示例组件" version="v1.0.0" description="选定图标按可见边界等比归一，保留原图形与操作标签。"
      details={<p className="maintenance-note">描述默认展开；操作紧随名称、窄屏只缩小图标，不执行维护。</p>}
      availableVersion="v1.0.1" location="/fixture/component"
      environment={[
        { id: "preview-environment", kind: "environment", label: "示例环境", description: "仅为展示，不读取或安装本机环境。" },
        { id: "preview-skill", kind: "skill", label: "示例 Skill", description: "技能类型图标。" },
        { id: "preview-mcp", kind: "mcp", label: "示例 MCP", description: "MCP 类型图标。" },
        { id: "preview-dependency", kind: "dependency", label: "示例依赖", description: "依赖组件类型图标。" },
      ]}
      actions={<><ComponentAction icon="refresh-cw" label="检查更新" onClick={() => setClicks(n => n + 1)} /><ComponentAction icon="download" label="安装" /><ComponentAction icon="arrow-up-to-line" label="更新 / 升级" primary /><ComponentAction icon="rotate-cw" label="重新安装" /><ComponentAction icon="trash-2" label="卸载 / 移除" danger /></>}
    />
    <ComponentCard label="补充动作" description="六个用户选定图标使用独立语义键，不改变原七图。" actions={<ComponentActions context={{ connected: true }} capabilities={[
      { id: "cleanup-package", label: "清理登记包", execute: () => {} },
      { id: "download-package", label: "仅下载安装包", execute: () => {} },
      { id: "install-cached", label: "使用缓存安装", execute: () => {} },
      { id: "open-installer", label: "打开系统安装器", execute: () => {} },
      { id: "switch-version", label: "切换推荐版本", execute: () => {} },
      { id: "repair", label: "修复（重新安装）", execute: () => {} },
    ]} />} />
    <ComponentCard label="兼容动作" actions={<><ComponentAction icon="package" label="安装已下载包" /><ComponentAction icon="scan" label="检查安装" /><ComponentAction icon="folder-open" label="查看安装包" /><ComponentAction icon="download" label="不可用安装" disabled disabledReason="连接已断开，请重连后重试。" onClick={() => setBlockedClicks(n => n + 1)} /></>} />
    <output aria-label="模拟检查次数">{clicks}</output><output aria-label="阻塞误提交次数">{blockedClicks}</output>
  </main></>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
