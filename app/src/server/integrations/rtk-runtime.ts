import { withCommandAdmission } from "../command-admission.js";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionFactory, ToolResultEvent, ToolResultEventResult } from "@earendil-works/pi-coding-agent";
import { rtkPolicies, type RtkEvent, type RtkLevel, type RtkReason } from "../../shared/rtk.js";
import { readRtkConfig, rtkDirectory, rtkExecutable } from "./rtk-config.js";
import { runRtk, type RtkRun } from "./rtk-process.js";
import { recordRtkEvent, saveRtkOriginal } from "./rtk-stats.js";

/** Only options known to preserve newline-delimited paths are accepted. */
function pathArguments(exe: string, args: string[]) {
  const flags = exe === "find" ? ["-H", "-L", "-P", "-print", "-a", "-and", "-o", "-or", "!", "-not", "(", ")", "-prune", "-empty"]
    : exe === "fd" ? ["--hidden", "-H", "--no-ignore", "-I", "--follow", "-L", "--absolute-path", "-a", "--full-path", "-p", "--fixed-strings", "-F", "--case-sensitive", "-s", "--ignore-case", "-i"]
    : ["--files", "--hidden", "--no-ignore", "--no-ignore-vcs", "--follow", "-L", "--sort-files"];
  const values = exe === "find" ? ["-name", "-iname", "-path", "-ipath", "-type", "-maxdepth", "-mindepth"]
    : exe === "fd" ? ["--type", "-t", "--extension", "-e", "--exclude", "-E", "--max-depth", "-d", "--base-directory"]
    : ["--glob", "-g", "--iglob", "--type", "-t", "--type-not", "-T", "--sort", "--sortr", "--max-depth"];
  let filesMode = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--" && exe !== "find") return exe !== "rg" || filesMode;
    if (flags.includes(arg)) { if (arg === "--files") filesMode = true; continue; }
    if (values.includes(arg)) { if (++i >= args.length) return false; continue; }
    if (values.some(flag => flag.startsWith("--") && arg.startsWith(flag + "=") && arg.length > flag.length + 1)) continue;
    if (arg.startsWith("-")) return false;
  }
  return exe !== "rg" || filesMode;
}
function patchArguments(args: string[]) {
  const flags = ["-p", "--patch", "-u", "--no-ext-diff", "--no-textconv", "--no-color", "--color=never", "--cached", "--staged", "--minimal", "--patience", "--histogram", "-w", "--ignore-all-space", "-b", "--ignore-space-change", "--ignore-space-at-eol", "--ignore-cr-at-eol", "--ignore-blank-lines", "--relative", "--no-renames"];
  for (const arg of args) {
    if (arg === "--") return true;
    if (!arg.startsWith("-") || flags.includes(arg) || /^(?:-U\d+|--unified=\d+)$/.test(arg)) continue;
    return false;
  }
  return true;
}
/** Parse literal shell words; operators and expansions are not eligible for filtering. */
function literalWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word = "", started = false, quote = "";
  for (const char of command) {
    if (char === "\n" || char === "\r" || char === "\0") return;
    if (quote) {
      if (char === quote) { quote = ""; continue; }
      // Single quotes make regex metacharacters literal; double quotes still expand these.
      if (quote === '"' && /[$`\\]/.test(char)) return;
      word += char;
    } else if (char === "'" || char === '"') {
      quote = char; started = true;
    } else if (/\s/.test(char)) {
      if (started) { words.push(word); word = ""; started = false; }
    } else {
      if (/[;&|<>`$\\(){}#]/.test(char)) return;
      word += char; started = true;
    }
  }
  if (quote) return;
  if (started) words.push(word);
  return words.length ? words : undefined;
}
/** Deliberately a small command grammar: ambiguous shell syntax is never guessed. */
export function rtkFilter(command: string, text: string, level: RtkLevel, platform: NodeJS.Platform = process.platform): string | undefined {
  command = command.trim();
  const cd = /^cd\s+(?:"[^"\n$`]+"|'[^'\n]+'|[\w./ -]+?)\s*&&\s*/.exec(command);
  if (cd) command = command.slice(cd[0].length);
  if (text.includes("\0") || /\x1b\[/.test(text)) return;
  const tokens = literalWords(command);
  if (!tokens) return;
  if (["npx", "pnpm", "yarn", "bun"].includes(tokens[0])) {
    const wrapper = tokens.shift();
    if (wrapper === "npx") { if (tokens[0] === "--no-install") tokens.shift(); }
    else if (tokens[0] === (wrapper === "bun" ? "x" : "exec")) tokens.shift();
    else return;
    // Project scripts and arbitrary modules need not run the tool named by the script.
    if (!["vitest", "prettier"].includes(tokens[0])) return;
  }
  if (tokens[0] === "uv") {
    if (tokens[1] !== "run") return;
    tokens.splice(0, 2);
    if (!["pytest", "python", "python3"].includes(tokens[0])) return;
  }
  if (["python", "python3"].includes(tokens[0])) {
    if (tokens[1] !== "-m" || tokens[2] !== "pytest") return;
    tokens.splice(0, 2);
  }
  const [exe, verb] = tokens;
  if (exe === "cargo" && verb === "test" && /^test result: ok\./m.test(text)) return "cargo-test";
  if (exe === "pytest" && /=+ .*\d+ passed.*=+/.test(text)) return "pytest";
  if (exe === "ctest" && /100% tests passed, 0 tests failed/.test(text)) return "ctest";
  if (exe === "vitest" && (/Test Files\s+\d+ passed/.test(text) || /"numTotalTests"\s*:/.test(text))) return "vitest";
  if (exe === "go" && verb === "test" && tokens.includes("-json")) {
    try { if (text.trim().split("\n").every(line => typeof JSON.parse(line).Action === "string")) return "go-test"; } catch { return; }
  }
  if (exe === "prettier" && tokens.includes("--check") && /Checking formatting|All matched files/.test(text)) return "prettier";
  if (level === "conservative") return;
  if (exe === "git" && verb === "status" && tokens.some(t => ["--porcelain", "--porcelain=v1", "--short", "-s"].includes(t)) && text.trimEnd().split("\n").every(line => /^(?:[ MADRCU?!]{2} |## )/.test(line))) return "git-status";
  if (["rg", "fd", "find"].includes(exe) && pathArguments(exe, tokens.slice(1))) {
    // Windows find.exe searches file contents; it is not the POSIX path-listing utility.
    if (exe === "find" && platform === "win32") return;
    if (text.trim().split("\n").every(line => line.length > 0 && !/[\x00-\x1f:]/.test(line))) return "find";
  }
  if (level !== "aggressive") return;
  if (["rg", "grep"].includes(exe) && text.trimEnd().split("\n").every(line => /^[^:\n]+:\d+:/.test(line))) return "grep";
  if (exe === "git" && verb === "diff" && patchArguments(tokens.slice(2)) && text.startsWith("diff --git ") && !/^(?:GIT binary patch|Binary files )/m.test(text)) return "git-diff";
}

export async function filterRtkResult(root: string, role: "main" | "subagent", event: ToolResultEvent, signal?: AbortSignal, run: RtkRun = runRtk): Promise<ToolResultEventResult | undefined> {
  if (event.toolName !== "bash" && event.toolName !== "powershell") return;
  let config; try { config = readRtkConfig(root); } catch { return; }
  if (!config.enabled || (role === "subagent" && !config.subagents)) return;
  const start = performance.now(), id = randomUUID();
  const text = event.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  const bytes = Buffer.byteLength(text), version = config.installation?.version ?? "";
  let filter = "";
  const current = () => { try { return readRtkConfig(root).revision === config.revision; } catch { return false; } };
  const recordUnlocked = (reason: RtkReason, outputBytes = bytes) => {
    if (!current()) return;
    const value: RtkEvent = { id, at: Date.now(), role, level: config.level, filter, reason, inputBytes: bytes, outputBytes, durationMs: performance.now() - start, version };
    try { recordRtkEvent(root, value); } catch { /* Bookkeeping must never break or retry the tool. */ }
  };
  const record = (reason: RtkReason, outputBytes = bytes) => {
    try { withCommandAdmission(root, () => recordUnlocked(reason, outputBytes)); } catch { /* Cleanup owns admission; do not recreate cleared data. */ }
  };
  const skip = (reason: RtkReason) => { record(reason); return undefined; };
  if (signal?.aborted) return skip("cancelled");
  if (event.parentToolCallId) return skip("nested");
  if (event.isError) return skip("error");
  const structured = event.structuredContent as Record<string, unknown> | undefined;
  if (event.content.length !== 1 || event.content[0].type !== "text" || typeof event.input.command !== "string" || !structured || structured.exit_code !== 0 || typeof structured.output !== "string" || typeof structured.truncated !== "boolean") return skip("contract");
  if (structured.truncated || (event.details as { truncation?: unknown } | undefined)?.truncation || structured.output !== text) return skip("truncated");
  const policy = rtkPolicies[config.level];
  if (bytes < policy.minimum) return skip("small");
  if (bytes > 1024 * 1024 || text.includes("\ufffd")) return skip("contract");
  filter = rtkFilter(event.input.command, text, config.level) ?? "";
  if (!filter) return skip("unsupported");
  const executable = rtkExecutable(root, config);
  if (!executable || !existsSync(executable)) return skip("missing");
  try {
    const buffer = await run(executable, ["pipe", "--filter", filter], { root, input: text, signal, admissionCheck: () => {
      const fresh = readRtkConfig(root);
      if (fresh.revision !== config.revision || !fresh.enabled || (role === "subagent" && !fresh.subagents) || rtkExecutable(root, fresh) !== executable) throw Error("RTK 配置已变化，未启动旧程序。");
    } });
    if (!current()) return;
    if (signal?.aborted) return skip("cancelled");
    const output = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    const path = join(rtkDirectory(root), "originals", `${id}.txt`);
    const result = `${output.trimEnd()}\n\n[RTK 已过滤工具文本；可能省略细节。原文（7 天内、最多保留 200 条）：${path}]`;
    const size = Buffer.byteLength(result);
    if (!output.trim() || size > bytes * (1 - policy.saving)) return skip("unchanged");
    return withCommandAdmission(root, () => {
      if (!current() || signal?.aborted) return;
      try { saveRtkOriginal(root, id, text); } catch { recordUnlocked("storage"); return; }
      recordUnlocked("filtered", size);
      // Keep structured programmatic output and exit status intact.
      return { content: [{ type: "text" as const, text: result }], details: event.details, structuredContent: event.structuredContent };
    });
  } catch { return skip(signal?.aborted ? "cancelled" : "failed"); }
}
export function rtkExtension(root: string, role: "main" | "subagent"): ExtensionFactory {
  return pi => { pi.on("tool_result", (event, ctx) => filterRtkResult(root, role, event, ctx.signal)); };
}
