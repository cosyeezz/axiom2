import { fileURLToPath } from "node:url";
import { getCurrentSystemMessage, getSystemMessageText } from "@earendil-works/pi-ai";
// src/server and dist/server have the same depth; the skill ships as a package asset.
export const piDevelopmentSkillPath = fileURLToPath(new URL("../../skills/pi-development/SKILL.md", import.meta.url));
export const axiomSystemPrompt = "You are an AI assistant in Axiom. You help users communicate, research, analyze, and complete development tasks.";
// Pi 1.1.0 has no public preamble override that preserves its native tools/rules.
// Keep this version-bound bridge in one place, shared by execution and preview.
const native = await import(new URL("./core/system-prompt.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const defaults = native.buildSystemPromptSections({ cwd: "" });
function sectionsForAxiom(options) {
    const sections = native.buildSystemPromptSections(options);
    if (!options.customPrompt) {
        if (sections.preamble === defaults.preamble)
            sections.preamble = axiomSystemPrompt;
        if (sections.docs === defaults.docs)
            delete sections.docs;
    }
    return sections;
}
/** Preserve opaque extension prompts; adapt only a rendering of Pi's default prompt. */
function forcedPromptForAxiom(text, options) {
    if (options.customPrompt || !text.startsWith(`${defaults.preamble}\n\n`))
        return text;
    return axiomSystemPrompt + text.slice(defaults.preamble.length).replace(`\n\n${defaults.docs}`, "");
}
export function buildAxiomSystemPrompt(options) {
    return options.forceSystemPrompt !== undefined
        ? forcedPromptForAxiom(options.forceSystemPrompt, options)
        : getSystemMessageText({ role: "system", content: "", sections: sectionsForAxiom(options), timestamp: 0 });
}
const installed = new WeakSet();
/** Install before binding extensions or issuing requests. Survives resource reloads. */
export function installAxiomPrompt(session) {
    if (installed.has(session))
        return;
    const bridge = session;
    const prepare = bridge._preparePromptAndToolLoadout;
    if (typeof prepare !== "function" || !bridge._baseSystemPromptOptions)
        throw Error("Unsupported Pi prompt API; review the Axiom prompt bridge before upgrading Pi.");
    bridge._preparePromptAndToolLoadout = (options, messages = session.agent.state.messages) => {
        // Native preparation resolves the current executable and hidden tools first.
        // Re-diff the adapted sections, including older structured Pi transcripts.
        prepare.call(session, options, messages);
        if (options.forceSystemPrompt !== undefined)
            options.forceSystemPrompt = forcedPromptForAxiom(options.forceSystemPrompt, options);
        const sections = native.diffSystemPromptSections(getCurrentSystemMessage(messages)?.sections ?? {}, sectionsForAxiom(options));
        return sections ? { role: "system", content: "", sections, timestamp: Date.now() } : undefined;
    };
    Object.defineProperty(session, "systemPrompt", { configurable: true,
        get: () => buildAxiomSystemPrompt(bridge._runSystemPromptOptions ?? bridge._baseSystemPromptOptions) });
    installed.add(session);
}
//# sourceMappingURL=axiom-prompt.js.map