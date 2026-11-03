import fs from "node:fs";
import { webSearchTool } from "/Volumes/D_Work/axiom2/app/src/server/web-search-tool.ts";
import { webReadTool } from "/Volumes/D_Work/axiom2/app/src/server/web-read-tool.ts";
const key = JSON.parse(fs.readFileSync(process.env.HOME + "/.pi/agent/auth.json", "utf8"))["kiro.rs"].key;
const tools = [webSearchTool(async () => ({})), webReadTool(async () => ({}))].map(t => ({ name: t.name, description: t.description, input_schema: JSON.parse(JSON.stringify(t.parameters)) }));
const out = [];
for (let i = 0; i < 2; i++) {
  const r = await fetch("http://localhost:8990/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-opus-5.5", max_tokens: 400, tools, messages: [{ role: "user", content: "Search the web for the latest Node.js LTS version. Use a tool." }] }) });
  const j = await r.json();
  out.push({ http: r.status, toolUse: (j.content || []).filter(c => c.type === "tool_use").map(c => ({ name: c.name, input: c.input })), error: j.error?.message });
}
fs.writeFileSync("/tmp/axiom-search-real-def.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
