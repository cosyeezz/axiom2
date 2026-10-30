import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../src/client/chat/Markdown.js";
import { AnnotatedReply } from "../../src/client/chat/ReplyAnnotations.js";
import { realAssistantDiagram } from "./ascii-diagram-cases.js";
import { usagePanel } from "./ascii-usage-panel.js";
import { wideForm, mediumForm, narrowForm } from "./ascii-forms.js";
import { initializeTheme, setTheme } from "../../src/client/theme.js";
import icons from "../../src/client/icons.svg?raw";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";
import "../../src/client/styles/theme.css";

initializeTheme();
const sprite = document.createElement("div"); sprite.innerHTML = icons; sprite.hidden = true; document.body.append(sprite);
export const initialDiagram = [
  "未整理数量达到阈值 ─┐",
  "                    ├→ 尝试获取同一把整理锁",
  "定时检查未整理数据 ─┘       ├─ 失败：本次退出",
  "                            └─ 成功：读取本批数据并整理",
].join("\n");
function Fixture() {
  const [source, setSource] = useState(initialDiagram);
  const [streaming, setStreaming] = useState(false);
  const assistantMessage = `对，这就是**双触发入口、同一把整理锁**：\n\n\`\`\`text\n${realAssistantDiagram}\n\`\`\`\n\n关键约束：先拿锁，再读取本批数据。`;
  Object.assign(window, { asciiFixture: { setSource, setStreaming, setTheme, original: initialDiagram, realAssistantDiagram, assistantMessage, usagePanel, wideForm, mediumForm, narrowForm } });
  const block = (language: string, text: string) => `\`\`\`${language}\n${text}\n\`\`\``;
  return <main className="markdown" style={{ maxWidth: 1000, margin: "auto", padding: 12, minWidth: 0 }}>
    <h2>字符图本地美化</h2>
    <section id="plain"><Markdown text={`说明：\n${source}\n这里是结语。`} streaming={streaming} /></section>
    <section id="fenced"><Markdown text={block("text", source)} streaming={streaming} /></section>
    <section id="assistant"><article className="log-row message-result" aria-label="助手回复"><div className="message-body reply-body"><AnnotatedReply scope={{ workspaceId: "fixture", sessionId: "ascii-diagram" }} messageId="real-assistant" text={assistantMessage} streaming={streaming} /></div></article></section>
    <section id="usage-panel"><Markdown text={block("text", usagePanel)} streaming={streaming} /></section>
    <section id="form-wide"><h3>宽屏：五项一行</h3><Markdown text={block("text", wideForm)} streaming={streaming} /></section>
    <section id="form-medium"><h3>中等宽度：日期独占一行，其余两列</h3><Markdown text={block("text", mediumForm)} streaming={streaming} /></section>
    <section id="form-narrow"><h3>窄屏：单列</h3><Markdown text={block("text", narrowForm)} streaming={streaming} /></section>
    <section id="ascii"><Markdown text={block("", "+-----+       +-----+\n|start|------>| end |\n+-----+       +-----+")} /></section>
    <section id="vertical"><Markdown text={block("", "Start\n  |\n  v\n Done")} /></section>
    <section id="labels"><Markdown text={block("text", "┌────────┐\n│ C++    │\n│ a--b   │\n└────────┘")} /></section>
    <section id="inline"><Markdown text={`\`┌──────┐\n│ C++  │\n└──────┘\``} /></section>
    <section id="references"><Markdown text={`Read [guide][g]\n┌──────┐\n│ C++  │\n└──────┘\nDone\n\n[g]: https://example.com`} streaming={streaming} /></section>
    <section id="tree"><Markdown text={block("text", "├── src\n│   ├── a.ts\n│   ├── b.ts\n│   └── c.ts\n└── package.json")} /></section>
    <section id="code"><Markdown text={block("typescript", source)} /></section>
    <section id="table"><Markdown text="| A | B |\n| --- | --- |\n| x | y |" /></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
