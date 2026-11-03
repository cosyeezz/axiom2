import fs from "node:fs";
const key = JSON.parse(fs.readFileSync(process.env.HOME + "/.pi/agent/auth.json", "utf8"))["kiro.rs"].key;
const schema = { type: "object", required: ["queries"], properties: { queries: { type: "array", items: { type: "string" }, description: "Google search queries." } }, additionalProperties: false };
const other = { name: "read", description: "Read a file.", input_schema: { type: "object", required: ["path"], properties: { path: { type: "string" } } } };
async function trial(name) {
  const body = { model: "claude-sonnet-5.5", max_tokens: 300, stream: false,
    tools: [other, { name, description: "Search Google to find relevant web pages.", input_schema: schema }],
    tool_choice: { type: "tool", name },
    messages: [{ role: "user", content: "Find the current price of a Hetzner CX22 VPS." }] };
  const r = await fetch("http://localhost:8990/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
  const j = await r.json();
  return { name, http: r.status, toolUse: (j.content || []).filter(c => c.type === "tool_use").map(c => ({ name: c.name, input: c.input })), error: j.error?.message };
}
const out = [];
for (const n of ["web_search", "axiom_search", "web_search", "axiom_search"]) out.push(await trial(n));
fs.writeFileSync("/tmp/axiom-kiro-toolname-ab2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
