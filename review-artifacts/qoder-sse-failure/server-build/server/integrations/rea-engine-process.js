import { join } from "node:path";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";
import { runBuiltinTool } from "./builtin-operation.js";
/** Each check owns its complete process tree; stderr and exit 1 remain usable. */
export const runEngine = async (file, args, options) => {
    options.signal.throwIfAborted();
    const state = options.environmentDirectory ?? join(options.cwd, "integrations", "rea", "environment");
    prepareComponentEnvironment(state);
    // Sanitize after merging overrides too; callers must not restore host startup injections.
    const env = componentEnvironment(state, { ...process.env, ...options.env });
    const result = await runBuiltinTool("rea", file, args, { ...options, timeout: options.timeout ?? 30_000, env, limit: 2 * 1024 * 1024, errorLimit: 256 * 1024, output: "structured", errorOutput: args.includes("-XshowSettings:properties") ? "structured" : "tail" });
    return { code: result.code, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") };
};
//# sourceMappingURL=rea-engine-process.js.map