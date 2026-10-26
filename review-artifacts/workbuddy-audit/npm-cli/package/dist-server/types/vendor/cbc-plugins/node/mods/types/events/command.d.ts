/**
 * types/events/command.ts — the upstream shapes of `command.*`, re-exported from the
 * vendored declarations (`../claude-code`, Claude Code's own). Do not redefine
 * an upstream shape here: re-run `scripts/sync-claude-code-types.mjs`.
 */
import type { OpValueOf } from '../claude-code';
export type { CommandDescribeInput, CommandDescribeResult, CommandInfo, CommandPresentation, CommandRunArgs, CommandRunInput, CommandRunResult, CommandSource, CommandSpec, } from '../claude-code';
/** What `$.command.register` resolves to: the registered name. */
export type CommandRegisterResult = OpValueOf['command.register'];
//# sourceMappingURL=command.d.ts.map