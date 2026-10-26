import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Markdown } from "../../src/client/chat/Markdown.js";
import { initializeTheme, setTheme } from "../../src/client/theme.js";
import icons from "../../src/client/icons.svg?raw";
import "../../src/client/styles/tokens.css";
import "../../src/client/styles/workbench.css";
import "../../src/client/styles/theme.css";

initializeTheme();
const sprite = document.createElement("div"); sprite.innerHTML = icons; sprite.hidden = true; document.body.append(sprite);
function Fixture() {
  const [sql, setSql] = useState("select id, 'hello  world' as label from users where active = 1; -- keep\nselect 2;");
  const [json, setJson] = useState('{"id":9007199254740993123,"name":"hello  world","items":[true,null]}');
  const [diagram, setDiagram] = useState("flowchart LR\n  A[开始] --> B{检查}\n  B -->|通过| C[完成]");
  Object.assign(window, { codeFixture: { setSql, setJson, setDiagram, setTheme } });
  const block = (language: string, text: string) => <Markdown text={`\`\`\`${language}\n${text}\n\`\`\``} />;
  return <main className="markdown" style={{ maxWidth: 900, margin: "auto", padding: 12 }}>
    <section id="sql">{block("sql", sql)}</section>
    <section id="json">{block("json", json)}</section>
    <section id="mermaid">{block("mermaid", diagram)}</section>
    <section id="ordinary">{block("typescript", "const value = 42;")}</section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
