import type { Command } from '@genie/product';
/**
 * Keeps commands that an embedded Host can execute without owning CLI UI,
 * authentication, process lifecycle, or session-management behavior.
 */
export declare function isHostAvailableCommand(command: Pick<Command, 'name' | 'tags'>): boolean;
