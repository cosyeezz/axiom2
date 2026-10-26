import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { Mods } from '../../vendor/cbc-plugins/node/index.js';
/**
 * Official Mods `$.tool.check({ tool, input })` for a session: the engine's declarative
 * verdict on a call of `tool` with `input` (the rules, the mode and the tool's own check,
 * before the mode settles an ask), as `ToolCheckResult`.
 *
 * A query is asked outside any loop: it carries no call id and runs nothing (no tool, no
 * classic hook, no dialog, no auto-mode classifier), and an ask stays an ask. Rejects when
 * no tool has that name, as `$.tool.call` does: there is no verdict to give for it. An
 * `mcp__` name is checked under that name, as a deferred call's permission stage checks it,
 * listed or not: the session's listing leaves out an MCP tool a whole-tool deny rule names,
 * and the verdict on it is that deny.
 */
export declare function checkToolForMods(session: Session, args: {
    readonly tool: string;
    readonly input: unknown;
}, signal?: AbortSignal): Promise<Mods.ToolCheckResult>;
