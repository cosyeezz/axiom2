import { fileURLToPath } from "node:url";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage, getSystemMessageText, type SystemMessage } from "@earendil-works/pi-ai";
import type { AgentSession, BuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

// src/server and dist/server have the same depth; the skill ships as a package asset.
export const piDevelopmentSkillPath = fileURLToPath(new URL("../../skills/pi-development/SKILL.md", import.meta.url));
export const axiomSystemPrompt = "You are an AI assistant in Axiom. You help users communicate, research, analyze, and complete development tasks.";
export const neutralSystemPrompt = "You are an AI assistant. You help users communicate, research, analyze, and complete development tasks.";
const identityFor = (api?: string) => api === "kiro-chat" ? neutralSystemPrompt : axiomSystemPrompt;

// Pi 1.1.0 has no public preamble override that preserves its native tools/rules.
// Keep this version-bound bridge in one place, shared by execution and preview.
const native = await import(new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href) as {
  buildSystemPromptSections(input: BuildSystemPromptOptions): Record<string, string>;
  diffSystemPromptSections(previous: Record<string, string | null>, current: Record<string, string>): SystemMessage["sections"];
};
const defaults = native.buildSystemPromptSections({ cwd: "" });

function sectionsForAxiom(options: BuildSystemPromptOptions, api?: string): Record<string, string> {
  // Only the shipped skill's generated catalog description is adapted. Never
  // scan arbitrary system text, user skills, file paths, or tool results.
  const input = api === "kiro-chat" ? { ...options, skills: options.skills?.map(skill =>
    skill.filePath === piDevelopmentSkillPath ? { ...skill, description: skill.description
      .replace("Axiom is built on Pi.", "This application is built on Pi.")
      .replace("Axiom's underlying", "the application's underlying") } : skill) } : options;
  const sections = native.buildSystemPromptSections(input);
  if (!options.customPrompt) {
    if (sections.preamble === defaults.preamble) sections.preamble = identityFor(api);
    if (sections.docs === defaults.docs) delete sections.docs;
  }
  return sections;
}

/** Preserve opaque extension prompts; adapt only a rendering of Pi's default prompt. */
function forcedPromptForAxiom(text: string, options: BuildSystemPromptOptions, api?: string): string {
  if (options.customPrompt || !text.startsWith(`${defaults.preamble}\n\n`)) return text;
  if (api === "kiro-chat") {
    const original = getSystemMessageText({ role: "system", content: "", sections: native.buildSystemPromptSections(options), timestamp: 0 });
    if (text.startsWith(original)) return getSystemMessageText({ role: "system", content: "",
      sections: sectionsForAxiom(options, api), timestamp: 0 }) + text.slice(original.length);
  }
  return identityFor(api) + text.slice(defaults.preamble.length).replace(`\n\n${defaults.docs}`, "");
}

export function buildAxiomSystemPrompt(options: BuildSystemPromptOptions, api?: string): string {
  return options.forceSystemPrompt !== undefined
    ? forcedPromptForAxiom(options.forceSystemPrompt, options, api)
    : getSystemMessageText({ role: "system", content: "", sections: sectionsForAxiom(options, api), timestamp: 0 });
}

type PromptSession = {
  _baseSystemPromptOptions: BuildSystemPromptOptions;
  _runSystemPromptOptions?: BuildSystemPromptOptions;
  _preparePromptAndToolLoadout(options: BuildSystemPromptOptions, messages?: AgentMessage[]): SystemMessage | undefined;
};
const installed = new WeakSet<AgentSession>();

/** Install before binding extensions or issuing requests. Survives resource reloads. */
export function installAxiomPrompt(session: AgentSession): void {
  if (installed.has(session)) return;
  const bridge = session as unknown as PromptSession;
  const prepare = bridge._preparePromptAndToolLoadout;
  if (typeof prepare !== "function" || !bridge._baseSystemPromptOptions)
    throw Error("Unsupported Pi prompt API; review the Axiom prompt bridge before upgrading Pi.");
  // Remember only prompts this bridge actually adapted. Model changes must not
  // mistake our prior output for an opaque user/extension prompt, or rewrite it
  // by matching the branded text in arbitrary caller content.
  const forcedSources = new WeakMap<BuildSystemPromptOptions, { source: string; adapted: string }>();
  const sourceOptions = (options: BuildSystemPromptOptions): BuildSystemPromptOptions => {
    const prior = forcedSources.get(options);
    return prior && options.forceSystemPrompt === prior.adapted ? { ...options, forceSystemPrompt: prior.source } : options;
  };
  bridge._preparePromptAndToolLoadout = (options, messages = session.agent.state.messages) => {
    // Native preparation resolves the current executable and hidden tools first.
    // Re-diff the adapted sections, including older structured Pi transcripts.
    prepare.call(session, options, messages);
    const api = session.model?.api;
    if (options.forceSystemPrompt !== undefined) {
      const source = sourceOptions(options).forceSystemPrompt!;
      const adapted = forcedPromptForAxiom(source, options, api);
      forcedSources.set(options, { source, adapted });
      options.forceSystemPrompt = adapted;
    }
    const sections = native.diffSystemPromptSections(getCurrentSystemMessage(messages)?.sections ?? {}, sectionsForAxiom(options, api));
    return sections ? { role: "system", content: "", sections, timestamp: Date.now() } : undefined;
  };
  Object.defineProperty(session, "systemPrompt", { configurable: true,
    get: () => buildAxiomSystemPrompt(sourceOptions(bridge._runSystemPromptOptions ?? bridge._baseSystemPromptOptions), session.model?.api) });
  installed.add(session);
}
