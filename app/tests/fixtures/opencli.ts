import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { executeOpenCli, type OpenCliExecute } from "../../src/server/integrations/opencli.js";
import { openCliSkillNames } from "../../src/server/integrations/opencli-runtime.js";

export function openCliFixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-opencli-"));
  const prefix = join(root, "global prefix"), modules = join(prefix, "node_modules");
  const packageRoot = join(modules, "@jackwener", "opencli");
  const calls: string[][] = [];
  let version = "1.8.8", failInstall = false, hold: Promise<void> | undefined;
  const install = (value: string, destination = packageRoot, bin = process.platform === "win32" ? prefix : join(prefix, "bin")) => {
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "package.json"), JSON.stringify({ name: "@jackwener/opencli", version: value, bin: { opencli: "cli.js" } }));
    const entry = join(destination, "cli.js");
    writeFileSync(entry, "#!/usr/bin/env node\nconsole.log(require('./package.json').version);\n"); chmodSync(entry, 0o755);
    mkdirSync(bin, { recursive: true });
    const shim = join(bin, process.platform === "win32" ? "opencli.cmd" : "opencli");
    if (process.platform === "win32") {
      writeFileSync(shim, `@"${process.execPath}" "${entry}" %*\r\n`);
      writeFileSync(join(bin, "opencli.ps1"), `& '${process.execPath.replace(/'/g, "''")}' '${entry.replace(/'/g, "''")}' @args\nexit $LASTEXITCODE\n`);
    } else { rmSync(shim, { force: true }); symlinkSync(entry, shim); }
    for (const name of openCliSkillNames) {
      const dir = join(destination, "skills", name); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Official fixture ${value}\n---\n\nRead this guide only when needed.\n`);
    }
  };
  const execute: OpenCliExecute = async (args, options) => {
    options.signal.throwIfAborted();
    calls.push(args);
    if (args[0] === "-e") return executeOpenCli(args, options);
    if (args[1] === "--version") return args[0] === "npm-cli.js" ? "11.0.0" : JSON.parse(readFileSync(join(dirname(args[0]), "package.json"), "utf8")).version;
    if (args[1] === "root") return modules;
    if (args[1] === "prefix") return prefix;
    if (args[1] === "view") return JSON.stringify(version);
    if (args[1] === "doctor") return "[MISSING] Extension: not connected\nBrowser connectivity test failed";
    if (args[1] === "install") {
      if (hold) await Promise.race([hold, new Promise((_, reject) => options.signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }))]);
      if (failInstall) throw Error("fixture network failure token=secret-value");
      const prefix = args[args.indexOf("--prefix") + 1];
      assert.ok(args.includes("--global=false")); assert.ok(!args.includes("--global"));
      install(version, join(prefix, "node_modules", "@jackwener", "opencli"), join(prefix, "node_modules", ".bin")); return "installed";
    }
    throw Error(`Unexpected arguments: ${args.join(" ")}`);
  };
  return { root, prefix, packageRoot, calls, install, execute, locateNpm: () => "npm-cli.js", setVersion: (value: string) => { version = value; }, fail: () => { failInstall = true; }, hold: (value: Promise<void>) => { hold = value; } };
}
