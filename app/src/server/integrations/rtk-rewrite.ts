import { basename, join } from "node:path";
import type { RtkLevel } from "../../shared/rtk.js";
import { rtkDirectory } from "./rtk-config.js";

type Word = { value: string; start: number; end: number };
type Command = { words: Word[]; after: string };

// These are shell grammar/state boundaries, not RTK command mappings. Wrappers
// can hide a second command position; builtins can change aliases/functions/hash
// before a later command. Do not partially adopt any such command list.
const unsafeCommands = new Set([
  "!", "if", "then", "else", "elif", "fi", "case", "esac", "for", "select", "while", "until", "do", "done", "in", "function", "coproc", "time",
  "env", "command", "builtin", "exec", "sudo", "su", "doas", "nice", "nohup", "timeout", "watch", "xargs", "parallel", "stdbuf", "unbuffer", "chroot", "nsenter", "setsid",
  "bash", "sh", "dash", "zsh", "ksh", "fish", "csh", "tcsh", "pwsh", "powershell",
  ".", "source", "eval", "alias", "unalias", "enable", "hash", "history", "fc", "shopt", "set", "unset", "export", "declare", "typeset", "local", "readonly", "let", "printf", "read", "readarray", "mapfile", "trap", "bind", "complete", "compopt", "getopts", "shift", "pushd", "popd", "return", "break", "continue", "exit", "logout", "ulimit", "umask",
]);

/** A safety gate, NOT a command rewriter. Official RTK alone chooses replacements.
 * Only literal Bash command lists are understood; never guess at shell expansion,
 * redirection, wrappers, functions, or substitutions. Offsets bind command words,
 * not occurrences of "rtk" in arguments, quoted strings, or file names. */
function commands(source: string): Command[] | undefined {
  // JS \s includes NBSP/VT/FF/etc., which Bash does not treat as separators.
  // Reject them (even inside quotes) rather than normalize or guess.
  if (/[^\S \t\n]/u.test(source)) return;
  const result: Command[] = [];
  let words: Word[] = [], value = "", start = -1, quote = "", pending = "";
  const word = (end: number) => {
    if (start >= 0) words.push({ value, start, end });
    value = ""; start = -1;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (/[\0\r]/.test(char)) return;
    if (quote) {
      if (char === quote) quote = "";
      else {
        if (char === "\n" || (quote === '"' && /[$`\\]/.test(char))) return;
        value += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      if (start < 0) start = i;
      quote = char; continue;
    }
    if (char === "\\") {
      if (i + 1 >= source.length || source[i + 1] === "\n") return;
      if (start < 0) start = i;
      value += source[++i]; continue;
    }
    if (/[<>`$(){}#*?\[\]~]/.test(char)) return;
    if (/[;&|\n]/.test(char)) {
      word(i);
      const op = (char === "&" || char === "|") && source[i + 1] === char ? char + source[++i] : char;
      if (op === "&") return;
      if (!words.length) {
        if (op === "\n" && (!pending || pending === ";" || pending === "\n")) continue;
        return;
      }
      result.push({ words, after: op }); words = []; pending = op;
    } else if (/[ \t]/.test(char)) word(i);
    else {
      if (start < 0) start = i;
      value += char; pending = "";
    }
  }
  if (quote) return;
  word(source.length);
  if (words.length) result.push({ words, after: "" });
  else if (pending && ![";", "\n"].includes(pending)) return;
  if (result.some(command => unsafeCommands.has(basename(command.words[executable(command, source)]?.value ?? "")))) return;
  return result.length ? result : undefined;
}
function executable(command: Command, source: string) {
  let index = 0;
  // Bash assignment syntax requires an unquoted/unescaped NAME= prefix.
  // 'A=B' and A\\=B are command names, while A='B C' is an assignment.
  while (command.words[index] && /^[A-Za-z_][A-Za-z_0-9]*=/.test(source.slice(command.words[index].start, command.words[index].end))) index++;
  return index;
}
export function rtkRewriteEligibility(source: string): "eligible" | "already_rtk" | "rewrite_policy" {
  const parsed = commands(source);
  if (!parsed || source.length > 32_768) return "rewrite_policy";
  for (const command of parsed) {
    const index = executable(command, source), name = command.words[index]?.value;
    if (!name || command.words.slice(0, index).some(word => word.value.startsWith("RTK_"))) return "rewrite_policy";
    if (/^rtk(?:\.exe)?$/i.test(basename(name))) return "already_rtk";
    // Machine-oriented output must not silently become display-only text.
    if (command.words.some(word => /^(?:--json(?:=.*)?|--porcelain(?:=.*)?|--raw|--numstat|--name-only|--name-status|--format(?:=.*)?|--pretty(?:=.*)?|--output(?:=.*)?|-z|-0|--null|--zero)$/.test(word.value))) return "rewrite_policy";
    // Official 1.0.1 can turn find failures into success, changing &&/||.
    // Keep original execution + safe successful-result postprocessing instead.
    if (name === "find") return "rewrite_policy";
  }
  return "eligible";
}
function allowed(words: Word[], level: RtkLevel) {
  if (level === "conservative") return false; // Test/check failures still use the established postprocessor.
  const [tool, verb] = words.map(word => word.value);
  if (tool === "git") return ["status", "log", ...(level === "aggressive" ? ["diff"] : [])].includes(verb);
  return ["ls", ...(level === "aggressive" ? ["grep"] : [])].includes(tool);
}
function quote(value: string) { return `'${value.replaceAll("'", `'\\''`)}'`; }

/** Bind ONLY official-generated, bare RTK command positions to the managed binary.
 * Each invocation gets private RTK databases, with recall/tee/telemetry disabled;
 * unrelated commands keep their environment. No PATH shadowing or global replace. */
export function bindRtkRewrite(root: string, source: string, candidate: string, file: string, level: RtkLevel): string | undefined {
  if (rtkRewriteEligibility(source) !== "eligible" || candidate === source || candidate.length > 65_536) return;
  const parsed = commands(candidate);
  if (!parsed) return;
  const positions: Word[] = [];
  for (const command of parsed) {
    const index = executable(command, candidate), token = command.words[index];
    // A new bare RTK token in any unrecognized position could be a hidden
    // command under a wrapper. Never leave it to resolve through user PATH.
    if (command.words.some((word, i) => i !== index && word.value === "rtk" && candidate.slice(word.start, word.end) === "rtk")) return;
    if (token && /^rtk(?:\.exe)?$/i.test(basename(token.value)) && token.value !== "rtk") return;
    if (!token || token.value !== "rtk") continue;
    // Never compress a pipeline producer: downstream data/exit behaviour is a contract.
    if (candidate.slice(token.start, token.end) !== "rtk" || command.after === "|" || !allowed(command.words.slice(index + 1), level)) return;
    positions.push(token);
  }
  if (!positions.length) return;
  const directory = rtkDirectory(root);
  const invocation = `RTK_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1 RTK_RECALL=0 RTK_TEE=0 RTK_DB_PATH=${quote(join(directory, "upstream.db"))} RTK_RECALL_DB=${quote(join(directory, "upstream-recall.db"))} ${quote(file)}`;
  let output = candidate;
  for (const token of positions.reverse()) output = output.slice(0, token.start) + invocation + output.slice(token.end);
  return output;
}
