import type { AvailableCommand } from '@agentclientprotocol/sdk';
import type { Command, Skill } from '@genie/product';
export declare function normalizeAvailableCommandName(name: string): string;
/**
 * Projects the executable Agent command catalog plus already-filtered visible skills
 * into one deterministic ACP snapshot. Later command definitions replace earlier ones
 * at the same stable position, matching the runtime precedence of dynamic overrides;
 * a command also wins over a same-name Skill alias.
 */
export declare function projectAcpAvailableCommands(commands: ReadonlyArray<Pick<Command, 'name' | 'description' | 'argumentHint'>>, visibleSkills: ReadonlyArray<Pick<Skill, 'name' | 'description' | 'source'>>): AvailableCommand[];
