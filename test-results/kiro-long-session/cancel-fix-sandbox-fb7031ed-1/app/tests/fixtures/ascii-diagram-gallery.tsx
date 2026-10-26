import { createRoot } from "react-dom/client";
import { Markdown } from "../../src/client/chat/Markdown.js";
import { initializeTheme, setTheme } from "../../src/client/theme.js";
import icons from "../../src/client/icons.svg?raw";
import { diagramCases } from "./ascii-diagram-cases.js";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/chat.css";
import "../../src/client/styles/theme.css";
initializeTheme();
Object.assign(window, { asciiGallery: { setTheme } });
const sprite = document.createElement("div"); sprite.innerHTML = icons; sprite.hidden = true; document.body.append(sprite);
createRoot(document.getElementById("root")!).render(<main className="markdown" style={{ padding: 16, maxWidth: 1500, margin: "auto", minWidth: 0 }}>
  <h1>字符图：原文 / 本地美化对照</h1>
  {diagramCases.map(test => <section key={test.id} id={test.id} style={{ marginBottom: 28, minWidth: 0 }}>
    <h3>{test.title}</h3>
    <div className="gallery-pair" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,580px),1fr))", gap: 12 }}>
      <div className="code-card" style={{ minWidth: 0 }}><div className="code-head">原文（相同14px字体）</div><pre style={{ whiteSpace: "pre", overflow: "auto", fontSize: 14, lineHeight: "22px", tabSize: 4 }}><code>{test.source}</code></pre></div>
      <div style={{ minWidth: 0 }}><Markdown text={`\`\`\`text\n${test.source}\n\`\`\``} /></div>
    </div>
  </section>)}
</main>);
