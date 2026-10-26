// Runs inside the command supervisor, including the MCP server it launches.
import { McpClient, StdioTransport } from "@earendil-works/pi-mcp";
import { errorMessage } from "../error-message.js";
import { inspectReaProgram, readReaConfig, reaNode, reaProcessEnvironment } from "./rea-runtime.js";
import { prepareComponentEnvironment } from "./component-environment.js";
import { discoverEnginePaths, engineEnvironment } from "./rea-engines.js";
const [root, packageRoot, version, rawConfig] = process.argv.slice(2);
const config = rawConfig ? JSON.parse(rawConfig) : readReaConfig(root);
const env = { ...reaProcessEnvironment(root, config), ...engineEnvironment(discoverEnginePaths(config.engines)) };
prepareComponentEnvironment(env.XDG_STATE_HOME.replace(/[\\/]state$/, ""));
const { entry } = inspectReaProgram(packageRoot, version);
// The outer task owns the live total/install deadline. Internal requests must
// not silently impose an unrelated 45-second budget.
const client = new McpClient({ name: "axiom-rea-check", version: "1.0.0", requestTimeoutMs: 86_400_000 });
let stderrBytes = 0;
const transport = new StdioTransport({ onStderr: text => { stderrBytes += Buffer.byteLength(text); }, command: reaNode(root, config), args: [entry, "mcp"], cwd: root, maxStderrBytes: 65536, inheritEnv: false, env: Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== undefined)) });
async function check() {
    try {
        const result = await client.connect(transport);
        if (result.serverInfo.name !== "rea" || result.serverInfo.version !== version)
            throw Error("REA MCP 服务版本不匹配。");
        const tools = await client.listTools();
        if (!tools.some(tool => tool.name === "binary_session"))
            throw Error("REA 未提供会话检查工具。");
        const session = await client.callTool("binary_session", { expected_package_version: version });
        if (session.isError)
            throw Error("REA 会话检查失败，请检查安装依赖。");
        process.stdout.write(JSON.stringify({ text: `REA ${version} 连接成功，发现 ${tools.length} 个工具；binary_session 调用通过。原生反编译引擎需单独配置。`, toolCount: tools.length, at: Date.now() }));
    }
    finally {
        await client.close();
    }
}
try {
    await check();
}
catch (error) {
    // Read after close so stderr is drained, including errors during shutdown.
    // Keep the subprocess's bounded tail and redact before the UI-size limit.
    const reason = error instanceof Error ? error.message : "REA MCP 检查失败。";
    const diagnostic = errorMessage(transport.stderr, "", true, stderrBytes > 65536);
    process.stderr.write(errorMessage(`${reason}\n${diagnostic}`, "REA MCP 检查未完成，请检查安装依赖。", true));
    process.exitCode = 1;
}
//# sourceMappingURL=rea-diagnostic-worker.js.map