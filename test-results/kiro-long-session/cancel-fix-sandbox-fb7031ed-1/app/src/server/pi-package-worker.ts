import { piPackagePlan } from "./pi-package-storage.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { PiPackageReply, PiPackageRequest, PiPackageResult } from "./pi-package-protocol.js";

// Private IPC entry; never loads package extensions. The parent owns cancellation
// and terminates this process group, including npm/git and lifecycle children.
process.once("message", async (request: PiPackageRequest) => {
  let reply: PiPackageReply;
  try {
    if (!request || !["install", "remove"].includes(request.action) || typeof request.source !== "string" || typeof request.cwd !== "string" || typeof request.agentDir !== "string" || typeof request.local !== "boolean") throw Error("Invalid package request");
    const plan = piPackagePlan(request), { manager, parsed } = plan;
    // The parent withdraws declarations before removal, and commits installations
    // only after process completion. npm/git never writes settings.json.
    if (request.action === "remove") await manager.remove(plan.source, { local: request.local });
    else await manager.install(plan.source, { local: request.local });
    const result: PiPackageResult = {};
    if (request.action === "install") {
      const path = plan.directory ?? manager.getInstalledPath(request.source, request.local ? "project" : "user");
      if (!path || !existsSync(path)) throw Error("Installed package missing");
      piPackagePlan(request); // Recheck the physical parent chain after installation.
      result.installedPath = path;
      if (parsed.type === "npm") {
        const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
        const matches = Reflect.get(manager, "installedNpmMatchesConfiguredVersion");
        if (pkg.name !== parsed.name || typeof pkg.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.+-]+)?$/.test(pkg.version) || typeof matches !== "function" || !await matches.call(manager, parsed, path)) throw Error("Installed package identity/version mismatch");
        result.version = pkg.version;
      } else {
        try { const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8")); if (typeof pkg.version === "string") result.version = pkg.version; } catch { /* Git/local packages need not contain package.json. */ }
      }
      if (parsed.type === "git") {
        const { stdout } = await promisify(execFile)("git", ["-C", path, "rev-parse", "HEAD"], { windowsHide: true, maxBuffer: 1024 });
        if (!/^[a-f0-9]{40,64}$/i.test(stdout.trim())) throw Error("Invalid git revision");
        result.commit = stdout.trim();
      }
    }
    reply = { ok: true, result };
  } catch { reply = { ok: false }; }
  // Error output from package managers can include credentials; only the typed
  // result crosses IPC. Wait for delivery before exiting with the actual outcome.
  process.send?.(reply, () => process.exit(reply.ok ? 0 : 1));
});
process.once("disconnect", () => {
  // A lost parent must not leave a POSIX installer tree running. Windows trees
  // belong to the parent's kill-on-close Job Object.
  if (process.platform !== "win32") { try { process.kill(-process.pid, "SIGKILL"); } catch {} }
  process.exit(1);
});
