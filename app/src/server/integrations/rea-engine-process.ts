import { join } from "node:path";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";
import { runBuiltinTool } from "./builtin-operation.js";

export type EngineRun = (file: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; signal: AbortSignal; timeout?: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
/** Each check owns its complete process tree; stderr and exit 1 remain usable. */
export const runEngine: EngineRun = async (file, args, options) => {
  options.signal.throwIfAborted();
  const state = join(options.cwd, "integrations", "rea", "environment");
  prepareComponentEnvironment(state);
  const result = await runBuiltinTool("rea", file, args, { ...options, timeout: options.timeout ?? 30_000, env: { ...componentEnvironment(state), ...options.env, NO_COLOR: "1" }, limit: 2 * 1024 * 1024, errorLimit: 256 * 1024, output: "structured", errorOutput: args.includes("-XshowSettings:properties") ? "structured" : "tail" });
  return { code: result.code, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") };
};
