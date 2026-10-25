import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryNodeInspector } from "../../src/client/memory/MemoryNodeInspector.js";
import { memoryMapNodes } from "../../src/client/memory/memory-map-layout.js";
import type { MemoryDocumentRef, MemoryPurpose } from "../../src/shared/memory-tree.js";
import type { MemoryCatalogEntry } from "../../src/shared/memory.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/theme.css";
import "../../src/client/styles/memory-tree.css";
const purposes: MemoryPurpose[] = ["primary", "secondary"].map((sessionId, index) => ({ id: `p${index}`, text: `原始目的${index}`, source: { sessionId, path: "MEMORY.md", key: JSON.stringify([`原始目的${index}`]) } }));
const first: MemoryDocumentRef = { sessionId: "primary", path: "details/共用资料.md", title: "共用资料", state: "已完成", purposeIds: ["p0"], ancestors: [] };
const refs: MemoryDocumentRef[] = [first, { ...first, purposeIds: ["p1"] }, { ...first, sessionId: "secondary", purposeIds: ["p1"] },
  ...Array.from({ length: 8 }, (_, index) => ({ ...first, title: `备忘${index}`, path: `details/备忘${index}.md` }))];
const roots = memoryMapNodes([{ id: "0", name: "多文档节点", titlePath: "工程实践 / 多文档节点", purposeIds: ["p0", "p1"], documentRefs: refs, children: [] },
  { id: "1", name: "无文件分类", titlePath: "工程实践 / 无文件分类", children: [{ id: "2", name: "子节点", children: [] }] }], purposes);
const catalog = [{ sessionId: "primary", sourceTitle: "主要来源" }, { sessionId: "secondary", sourceTitle: "另一来源" }] as MemoryCatalogEntry[];
function Fixture() {
  const [selected, select] = useState(0), [opened, open] = useState("");
  return <main style={{ color: "var(--fg)", background: "var(--bg)", minHeight: "100dvh", padding: 24 }}>
    <style>{`body{margin:0}*{box-sizing:border-box}button,input{font:inherit}.memory-tree-workspace{height:720px}`}</style>
    <button onClick={() => select(0)}>查看多文档节点</button><button onClick={() => select(1)}>查看无文件分类</button>
    <output aria-label="已请求打开">{opened}</output>
    <div className="memory-tree-workspace"><MemoryNodeInspector key={selected} node={roots[selected]} workspaceId="workspace" catalog={catalog}
      close={() => open("closed")} open={(scope, path) => open(JSON.stringify({ scope, path }))} /></div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
