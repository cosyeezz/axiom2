import { join } from "node:path";
import { componentEnvironment, prepareComponentEnvironment } from "./component-environment.js";
import { runTool } from "./tool-process.js";
/** Native components share supervision, never RTK-specific settings or databases. */
export async function runNative(file, args, options) {
    if (options.signal?.aborted) {
        options.onStopped?.("not-started");
        throw options.signal.reason;
    }
    const { environmentDirectory = join(options.root, "environment"), ...runOptions } = options;
    prepareComponentEnvironment(environmentDirectory);
    const env = componentEnvironment(environmentDirectory, { ...process.env, ...options.env });
    const result = await runTool(file, args, { ...runOptions, env,
        errorOutput: options.errorOutput ?? (options.output === "tail" ? "tail" : "structured") });
    if (result.code !== 0)
        throw Error("程序执行失败，请检查输入和安装状态。");
    return result.stdout;
}
//# sourceMappingURL=native-process.js.map