/**
 * `packages/agent-cli/src/node/cli/mods-lifecycle-bridge.ts`
 *
 * Typed dispatch helpers for every upstream middleware event that hasn't yet
 * been wired at its natural trigger site inside cbc-core / agent-cli / cbc-tui.
 *
 * ## Why a broker
 *
 * The upstream `codebuddy-code` type surface is fully aligned (§18.1 in
 * `packages/cbc-plugins/src/node/mods/API-ALIGNMENT.md`). What's still open is
 * the runtime dispatch: several events have precise types and mod authors can
 * `on('turn.start', ...)`, but no code in the cbc host currently fires those
 * dispatches. This file gives every dispatch site *one* import to reach for —
 * runtime code that has an event's payload in hand imports the helper here
 * and calls it, without having to know:
 *
 * - whether the mods runtime is initialised (`CBC_ENABLE_FUNCTION_HOOKS`),
 * - how to obtain the `ModsRuntime` instance,
 * - how to shape the `dispatch()` return into a native rewrite / deny,
 * - how to isolate errors so a mod's throw never breaks the host path.
 *
 * ## Contract
 *
 * Every helper returns `{ deny }` when a hook refused (host must surface),
 * a shape-typed rewrite payload when a hook changed the event (host must
 * use), or `undefined` when no hook intervened / the runtime is off (host
 * proceeds with its own defaults). Missing runtime is *never* an error path;
 * unhooked mods must never cause a regression against the baseline no-mods
 * behaviour.
 *
 * ## Backward compatibility
 *
 * Existing dispatch sites (`session.start` / `prompt.submit` / `command.run`
 * etc. — see API-ALIGNMENT.md §18.1's ✅ rows) already call
 * `runtime.dispatch()` directly. This file adds helpers for the ⬜ rows
 * without touching those existing sites; incremental adoption is the point.
 */
/** Whether a mods runtime is up to hear the host's events. */
export declare function hasModsRuntime(): boolean;
/** Whether some loaded mod hears `event` (skip per-keystroke dispatches otherwise). */
export declare function modsHear(event: string): boolean;
/** One typeahead row a `prompt.autocomplete` hook added. */
export interface ModAutocompleteRow {
    readonly text: string;
    readonly label: string;
    readonly description?: string;
}
/**
 * Official `prompt.autocomplete`: the run of non-whitespace ending at the
 * cursor goes down the chain; the rows the plugins answer are drawn beneath
 * the box's own. Nothing is raised for an empty token or when no mod hears it.
 */
export declare function autocompleteFromMods(text: string, cursor: number): Promise<ModAutocompleteRow[]>;
/**
 * Raise `event` with the host's own step as its core: the chain runs down to
 * `core(e)` with `e` as the hooks above left it, and what comes back is the
 * hooks' answer. With no runtime, the step runs as it would have.
 */
export declare function dispatchThroughMods<R extends Record<string, unknown>>(event: string, input: Record<string, unknown>, core: (e: Record<string, unknown>) => Promise<R> | R): Promise<R | Record<string, unknown>>;
export declare function fireSessionAttach(input: {
    surface: string;
    clientId: string;
    viewport?: {
        columns: number;
        rows: number;
    };
}): Promise<{
    clientId?: string;
} | undefined>;
export declare function fireSessionDetach(input: {
    surface: string;
    clientId: string;
    reason: 'detach' | 'end';
}): Promise<{
    clientId?: string;
} | undefined>;
export declare function fireSessionMeasure(input: {
    sessionId: string;
    tokens?: number;
    tokensIn?: number;
    tokensOut?: number;
    [k: string]: unknown;
}): Promise<{
    deny?: string;
} | undefined>;
export declare function fireSessionReceive(input: {
    sessionId: string;
    text: string;
    [k: string]: unknown;
}): Promise<{
    text?: string;
    drop?: string;
    deny?: string;
    [k: string]: unknown;
} | undefined>;
export declare function fireTurnStart(input: {
    turnId: string;
    text: string;
}): Promise<{
    turnId?: string;
    deny?: string;
} | undefined>;
export declare function fireTurnComplete(input: {
    turnId: string;
    agentId?: string;
    answer?: string;
    [k: string]: unknown;
}): Promise<{
    text?: string;
} | undefined>;
/**
 * `turn.step` is upstream's streaming event (each model chunk). Consuming it
 * requires the streaming-hook path (`HookStream`); this broker exposes the
 * non-streaming fold-style dispatch so hosts can flag chunks one-by-one.
 * Real streaming integration is a follow-up.
 */
export declare function fireTurnStep(input: {
    turnId: string;
    agentId?: string;
    chunk: unknown;
    [k: string]: unknown;
}): Promise<{
    deny?: string;
} | undefined>;
/**
 * Ask mods for a permission verdict on a tool call *before* the host's own
 * permission dialog / mode decides.
 *
 * A `{ decision: 'deny', reason }` short-circuits; `allow` runs the tool;
 * `ask` puts it to the mode's own decider. When no hook answers, returns
 * undefined and the host proceeds with its native permission logic.
 */
export declare function fireToolCheck(input: {
    tool: string;
    input: unknown;
    tool_use_id?: string;
    agentId?: string;
}, native?: {
    decision: 'allow' | 'ask' | 'deny';
    reason?: string;
    rule?: string;
}): Promise<{
    decision: 'allow' | 'ask' | 'deny';
    reason?: string;
    rule?: string;
} | undefined>;
/**
 * Fired before the Agent tool spawns a subagent. Hooks can rewrite the
 * subagent's prompt, description, subagent type, model, background flag, or
 * cwd; or return `{ deny }` to refuse the spawn.
 *
 * Returns the rewritten payload the host should use, or undefined for no
 * intervention.
 */
export declare function fireAgentSpawn(input: {
    tool_use_id: string;
    prompt: string;
    description: string;
    subagentType: string;
    parentModel: string;
    background: boolean;
    fork: boolean;
    model?: string;
    name?: string;
    cwd?: string;
    parentAgentId?: string;
    permissionMode?: string;
    provider: {
        plugin: string;
        tier: string;
    };
    [k: string]: unknown;
}): Promise<{
    deny?: string;
    prompt?: string;
    description?: string;
    subagentType?: string;
    model?: string;
    background?: boolean;
    cwd?: string;
} | undefined>;
/** Official `AgentOfferInput` of an agent definition: its source and the plugin providing it. */
export declare function agentOfferInput(agent: {
    name: string;
    description?: string;
    tags?: readonly string[];
}): {
    agent: string;
    description: string;
    source: string;
    provider: {
        plugin: string;
        tier: string;
    };
};
/**
 * Fired for each agent type the engine is about to offer the model (in the
 * agent listing or at dispatch). Hooks return `{ isOffered: false }` to hide.
 */
export declare function fireAgentOffer(input: {
    agent: string;
    description: string;
    source: string;
    provider: {
        plugin: string;
        tier: string;
    };
}): Promise<{
    isOffered?: boolean;
} | undefined>;
export declare function firePromptFill(input: {
    text: string;
    mode: 'replace' | 'append' | 'insert';
    origin: {
        kind: 'engine';
    } | {
        kind: 'plugin';
        name: string;
    };
}): Promise<{
    isFilled?: boolean;
    deny?: string;
} | undefined>;
export declare function firePromptSuggest(input: {
    text: string;
    origin: {
        kind: 'suggestion';
    } | {
        kind: 'plugin';
        name: string;
    };
}): Promise<{
    isShown?: boolean;
    deny?: string;
} | undefined>;
export declare function firePromptEdit(input: {
    origin: {
        kind: 'composer';
    };
    text: string;
    cursor: number;
    start: number;
    end: number;
    inputText: string;
    key?: {
        key: string;
        text?: string;
        [k: string]: unknown;
    };
}): Promise<{
    text?: string;
    cursor?: number;
    deny?: string;
    [k: string]: unknown;
} | undefined>;
export declare function firePromptSection(input: {
    name: string;
    text: string | null;
}): Promise<{
    text?: string | null;
    deny?: string;
} | undefined>;
export declare function firePromptAttachment(input: {
    type: string;
    text: string;
    origin: {
        kind: 'engine';
    } | {
        kind: 'hook';
        event: string;
    } | {
        kind: 'plugin';
        event: string;
    };
    agentId?: string;
}): Promise<{
    text?: string | null;
    deny?: string;
} | undefined>;
/**
 * Fired for each message before it's rendered on any surface. Hooks can
 * observe / annotate; not currently expected to rewrite (returning
 * `{ replace: tree }` is upstream's shape and remains available if a mod
 * takes it).
 */
export declare function fireUiMessage(input: {
    messageId: string;
    kind: 'user' | 'assistant' | 'system' | string;
    text?: string;
    [k: string]: unknown;
}): Promise<{
    deny?: string;
    [k: string]: unknown;
} | undefined>;
/**
 * Fired at each site the engine composes a piece of attributed text (commit
 * trailer, PR footer, exemption sentence, commit-gate remedy). Hooks return
 * `{ text }` to rewrite; leaving undefined uses the engine's own text.
 */
export declare function fireAttributionText(input: {
    kind: 'commit' | 'pr' | 'exemption' | 'remedy';
    text: string;
}): Promise<{
    text?: string;
    deny?: string;
} | undefined>;
/**
 * Fired just before a skill's prompt is expanded into the model's context.
 * Hooks can rewrite the prompt text or refuse the expansion.
 */
export declare function fireSkillPrompt(input: {
    skill: string;
    text: string;
}): Promise<{
    text?: string;
} | undefined>;
export declare function fireConfigSet(input: {
    key: string;
    value: unknown;
    previous: unknown;
    provider: {
        plugin: string;
        tier: string;
    };
    origin: {
        kind: string;
        [k: string]: unknown;
    };
}): Promise<{
    value?: unknown;
    deny?: string;
} | undefined>;
export declare function fireConfigDescribe(input: {
    key: string;
    label: string;
    description?: string;
    isHidden: boolean;
    provider: {
        plugin: string;
        tier: string;
    };
}): Promise<{
    label?: string;
    description?: string;
    isHidden?: boolean;
} | undefined>;
