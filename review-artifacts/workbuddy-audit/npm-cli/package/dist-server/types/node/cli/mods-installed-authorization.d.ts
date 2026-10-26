import { Mods, type PluginInfo } from '../../vendor/cbc-plugins/node/index.js';
/** A `--plugin-dir` directory of this process (PluginManager lists it under the reserved `inline` marketplace). */
export declare function isExplicitSessionDir(plugin: Pick<PluginInfo, 'marketplaceName' | 'installedPath'>): boolean;
/**
 * Host half of an installed Web package: trusted once the package itself has been approved (same per-package rule as
 * the browser half), so later source edits activate without re-approval. Returns the current fingerprint.
 */
export declare function assertInstalledModApproval(root: string, name: string, plugins: readonly PluginInfo[], grants: Readonly<Record<string, string>>): Promise<string | undefined>;
export declare function isApprovedInstalledOrigin(origin: Mods.Origin, live: Mods.RegisteredMod | undefined, fingerprint: string | undefined, approved: ReadonlyMap<string, {
    name: string;
    hash: string;
}>): boolean;
/** Authored privileges belong to the verified root/hash and the current live registration, not a reusable display name. */
export declare function isApprovedAuthoredOrigin(origin: Mods.Origin, live: Mods.RegisteredMod | undefined, approved: ReadonlyMap<string, {
    name: string;
    hash: string;
}>): boolean;
