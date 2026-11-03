import { spawn } from "node:child_process";
import { readOpenCliConfig, validateOpenCliPackage, openCliNode, openCliEnvironment } from "../integrations/opencli-runtime.js";
import { SearchError } from "./search-errors.js";

export interface OpenCliInvocation { node: string; entry: string; env: NodeJS.ProcessEnv }
export type OpenCliCommand = (args: string[], signal: AbortSignal) => Promise<unknown>;
export function searchOpenCliInvocation(root: string): OpenCliInvocation {
  try {
    const config = readOpenCliConfig(root);
    if (!config?.enabled || config.detached) throw Error("disabled");
    const { entry } = validateOpenCliPackage(config);
    const env = openCliEnvironment(config);
    // This tool uses the connected Chrome extension, never an unrelated CDP endpoint.
    delete env.OPENCLI_CDP_ENDPOINT;
    // Default close-window cleanup keeps one blank owned tab, so the search window is reused instead of re-created per query.
    delete env.OPENCLI_CLOSE_OWNED_TAB;
    return { node: openCliNode(config), entry, env };
  } catch {
    throw new SearchError("OPENCLI_UNAVAILABLE", "Enable and check the configured OpenCLI component before searching. No alternate browser or executable was used.", true);
  }
}

export function selectSearchProfile(data: any, requested?: string, exactContext = false): string {
  const profiles = Array.isArray(data?.profiles) ? data.profiles.filter((p: any) => typeof p?.contextId === "string" && p.contextId && p.connected === true) : [];
  const matches = requested ? profiles.filter((p: any) => p.contextId === requested || !exactContext && p.alias === requested) : profiles.filter((p: any) => p.default === true);
  const selected = matches.length === 1 ? matches[0] : !requested && matches.length === 0 && profiles.length === 1 ? profiles[0] : undefined;
  if (!selected) throw new SearchError("PROFILE_UNAVAILABLE", "Connect the selected Chrome profile or choose one OpenCLI default profile before searching.", true);
  return selected.contextId;
}

/** Execute the configured CLI entry, without a shell, cookie access, proxy changes or stderr disclosure. */
export function openCliCommand(invocation: OpenCliInvocation, args: string[], external: AbortSignal, timeoutMs = 30_000, maxBytes = 512_000): Promise<unknown> {
  const signal = AbortSignal.any([external, AbortSignal.timeout(timeoutMs)]);
  if (signal.aborted) return Promise.reject(new SearchError("CANCELLED", "OpenCLI search cancelled or timed out."));
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.node, [invocation.entry, ...args], { env: invocation.env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let bytes = 0, error: SearchError | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: SearchError) => {
      if (error) return;
      error = reason;
      // Kill only this invocation, not the shared OpenCLI daemon or user Chrome.
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
    };
    const abort = () => stop(new SearchError("CANCELLED", "OpenCLI search cancelled or timed out."));
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) stop(new SearchError("OUTPUT_LIMIT", "OpenCLI search output exceeded its limit."));
      else chunks.push(chunk);
    });
    // Drain but never retain diagnostics: they may contain profile names, URLs or page data.
    child.stderr.on("data", () => {});
    child.once("error", () => { error ??= new SearchError("OPENCLI_UNAVAILABLE", "The configured OpenCLI executable could not be started.", true); });
    child.once("close", code => {
      clearTimeout(killTimer); signal.removeEventListener("abort", abort);
      if (error) { reject(error); return; }
      let envelope: any;
      try { envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { reject(new SearchError("INVALID_RESPONSE", "OpenCLI returned invalid JSON.")); return; }
      if (code !== 0 || envelope?.ok !== true) {
        reject(new SearchError("OPENCLI_FAILED", "OpenCLI could not complete the browser command. Check its Chrome connection and selected profile.", true)); return;
      }
      resolve(envelope.data);
    });
    if (signal.aborted) abort();
  });
}
