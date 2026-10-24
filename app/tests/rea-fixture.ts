import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReaDependencies } from "../src/server/integrations/rea.js";
import type { ReaEngineId } from "../src/shared/rea-engines.js";
import type { EngineRelease } from "../src/server/integrations/rea-engine-install.js";
import { reaSkillName } from "../src/server/integrations/rea-runtime.js";

export function writeReaPackage(packageRoot: string, version: string, serverVersion = version) {
  mkdirSync(join(packageRoot, "scripts"), { recursive: true });
  mkdirSync(join(packageRoot, "dist", "mcp"), { recursive: true });
  const skill = join(packageRoot, "skills", reaSkillName);
  mkdirSync(join(skill, "references"), { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "rea-agents", version, bin: { rea: "scripts/rea.mjs" } }));
  writeFileSync(join(packageRoot, "dist", "mcp", "main.js"), "// Fixture packaged server\n");
  writeFileSync(join(skill, "SKILL.md"), `---\nname: ${reaSkillName}\ndescription: REA test fixture ${version}\n---\n\n[Guide](references/guide.md)\n`);
  writeFileSync(join(skill, "references", "guide.md"), "Fixture reference\n");
  writeFileSync(join(packageRoot, "scripts", "rea.mjs"), `
import { createInterface } from 'node:readline';
const lines = createInterface({ input: process.stdin });
lines.on('line', line => {
  const m = JSON.parse(line); if (m.id === undefined) return;
  let result;
  if (m.method === 'initialize') result = { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'rea', version: ${JSON.stringify(serverVersion)} } };
  else if (m.method === 'tools/list') result = { tools: [{ name: 'binary_session', description: 'Read session identity', inputSchema: { type: 'object' } }] };
  else if (m.method === 'tools/call') result = { content: [{ type: 'text', text: 'Fixture session checked' }], isError: m.params.name !== 'binary_session' || m.params.arguments.expected_package_version !== ${JSON.stringify(version)} };
  else throw Error('Unexpected MCP request: ' + m.method);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n');
});
lines.on('close', () => process.exit(0));
`);
}
export async function fixtureEngineRelease(id: ReaEngineId): Promise<EngineRelease> {
  if (id === "hopper") return { version: "6.6.0", url: "https://www.hopperapp.com/downloader/public/Hopper-6.6.0-demo.dmg", format: "dmg", sha1: "a".repeat(40), minimumSystem: "macOS 12.4+" };
  return { version: ({ java: "21.0.13+8", ghidra: "12.1.4", jadx: "0.7.1", wabt: "1.0.42" })[id], url: "https://github.com/fixture/engine", sha256: "a".repeat(64), format: id === "ghidra" ? "zip" : id === "jadx" ? "jar" : "tar.gz" };
}
export function reaFixture() {
  const calls: string[][] = [];
  let latest = "6.7.0", failure = false, mismatch = false, invalidSkill = false, gate: Promise<void> | undefined;
  const dependencies: ReaDependencies = {
    engineRelease: fixtureEngineRelease,
    locateNpm: () => "npm-cli-fixture.js",
    execute: async (args, options) => {
      calls.push(args);
      if (args[1] === "view") return JSON.stringify(latest);
      if (args[1] !== "install") throw Error("Unexpected npm command");
      if (gate) await new Promise<void>((resolve, reject) => {
        const abort = () => reject(Error("aborted"));
        options.signal.addEventListener("abort", abort, { once: true });
        gate!.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", abort));
      });
      options.signal.throwIfAborted();
      if (failure) throw Error("fixture network failure token=secret-value");
      const prefix = args[args.indexOf("--prefix") + 1], version = args.at(-1)!.split("@")[1];
      writeReaPackage(join(prefix, "node_modules", "rea-agents"), version, mismatch ? "0.0.0" : version);
      if (invalidSkill) writeFileSync(join(prefix, "node_modules", "rea-agents", "skills", reaSkillName, "SKILL.md"), "---\nname: wrong-skill\n---\nMissing description");
      return "installed";
    },
  };
  return { dependencies, calls, setLatest: (v: string) => { latest = v; }, fail: () => { failure = true; }, mismatch: () => { mismatch = true; }, invalidSkill: () => { invalidSkill = true; }, hold: (value: Promise<void>) => { gate = value; } };
}
