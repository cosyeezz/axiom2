import { execSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getShellConfig, type McpExtensionOptions } from "@earendil-works/pi-coding-agent";
import { StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import { EnvHttpProxyAgent, fetch as networkFetch } from "undici";
import { toolEnvironment } from "./model-proxy-env.js";

const expandHome = (value: string) => value === "~" ? homedir() : value.startsWith("~/") || process.platform === "win32" && value.startsWith("~\\") ? join(homedir(), value.slice(2)) : value;
// The public transport factory receives unresolved MCP env/header values. Preserve
// pi's documented interpolation, escaping and command semantics with the tool env.
export function resolveToolConfig(value: string, env: NodeJS.ProcessEnv): string {
  if (value.startsWith("!")) {
    try {
      const command = value.slice(1);
      let output: string;
      if (process.platform === "win32") {
        const config = getShellConfig();
        const stdin = config.commandTransport === "stdin";
        const result = spawnSync(config.shell, stdin ? config.args : [...config.args, command], {
          env, encoding: "utf8", input: stdin ? command : undefined, timeout: 10000,
          stdio: [stdin ? "pipe" : "ignore", "pipe", "ignore"], windowsHide: true,
        });
        if (result.error || result.status !== 0) throw Error();
        output = result.stdout;
      } else output = execSync(command, { env, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] });
      if (!output.trim()) throw Error();
      return output.trim();
    } catch { throw Error("MCP 配置命令未能返回有效值，请检查配置。"); }
  }
  return value.replace(/\$\{[^}]*\}|\$[$!]|\$[A-Za-z_][A-Za-z0-9_]*/g, token => {
    if (token === "$$" || token === "$!") return token.slice(1);
    const name = token.startsWith("${") ? token.slice(2, -1) : token.slice(1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return token;
    if (!env[name]) throw Error("MCP 配置引用的环境变量不存在。");
    return env[name]!;
  });
}
let dispatcher: EnvHttpProxyAgent | undefined;
export const modelToolTransport: NonNullable<McpExtensionOptions["createTransport"]> = (entry, cwd, authProvider) => {
  const env = toolEnvironment(process.env), config = entry.config;
  if ("url" in config) {
    dispatcher ??= new EnvHttpProxyAgent({ httpProxy: env.http_proxy ?? env.HTTP_PROXY ?? "", httpsProxy: env.https_proxy ?? env.HTTPS_PROXY ?? "", noProxy: env.no_proxy ?? env.NO_PROXY ?? "" });
    return new StreamableHttpTransport({ url: config.url, authProvider,
      headers: Object.fromEntries(Object.entries(config.headers ?? {}).map(([key, value]) => [key, resolveToolConfig(value, env)])),
      fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: Parameters<typeof globalThis.fetch>[1]) => networkFetch(input as Parameters<typeof networkFetch>[0], { ...init, dispatcher } as Parameters<typeof networkFetch>[1])) as unknown as typeof globalThis.fetch,
    });
  }
  const defined = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return new StdioTransport({ command: expandHome(config.command), args: config.args?.map(expandHome),
    cwd: resolve(cwd, expandHome(config.cwd ?? ".")), inheritEnv: false, stderr: "pipe",
    env: { ...defined, ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, resolveToolConfig(value, env)])) },
  });
};
