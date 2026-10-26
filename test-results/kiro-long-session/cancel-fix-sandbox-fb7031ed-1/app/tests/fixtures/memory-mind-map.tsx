import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryMindMap } from "../../src/client/memory/MemoryMindMap.js";
import type { MemoryMapNode } from "../../src/client/memory/memory-map-layout.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/theme.css";
import "../../src/client/styles/memory-tree.css";
const topics = [
  ["产品与交互", "全局记忆画布", "思维导图展开与折叠", "触控与键盘导航"],
  ["工程实践", "前端架构", "组件边界与状态管理", "可访问性与回归验证"],
  ["模型与供应商", "连接配置", "模型切换保持上下文", "请求失败的诊断方式"],
  ["会话与协作", "任务执行", "主代理和子代理协作", "长任务进度与交付"],
  ["知识与检索", "记忆整理", "按目的组织可复用经验", "查询必要的原文详情"],
  ["工作环境", "本地开发", "开发后台与桌面运行", "跨工作空间资源管理"],
];
const roots: MemoryMapNode[] = topics.map(([name, category, ...purposes], i) => ({ id: `root-${i}`, label: name, kind: "Directory", children: [
  { id: `category-${i}`, label: category, parent: `root-${i}`, kind: "Directory", children: purposes.map((text, j) => ({ id: `purpose-${i}-${j}`, label: text, parent: `category-${i}`, kind: "Purpose", children: [], purpose: { id: `purpose-${i}-${j}`, text, source: { sessionId: "fixture", path: "MEMORY.md", key: text, rootDetails: [] } } })) },
] }));
function Fixture() {
  const [query, setQuery] = useState(""), [selected, select] = useState<string>();
  return <main style={{ height: "100dvh", display: "flex", flexDirection: "column", padding: 16, gap: 12, boxSizing: "border-box", background: "var(--bg)", color: "var(--fg)", fontFamily: "var(--font-body)" }}>
    <style>{`body{margin:0}*{box-sizing:border-box}button,input{font:inherit}.fixture-header{display:flex;align-items:center;justify-content:space-between;gap:12px}.fixture-header input{min-width:0;width:240px;border:1px solid var(--border);background:var(--surface);color:var(--fg);padding:10px;border-radius:8px;font-size:12px}.fixture-header h1{margin:0;font-weight:500;font-size:16px;white-space:nowrap}`}</style>
    <header className="fixture-header"><h1>全局记忆</h1><input aria-label="搜索记忆" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索分类、目的或来源文件" /></header>
    <MemoryMindMap roots={roots} query={query} workspaceName="Axiom" loading={false} selected={selected} onSelect={select} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
