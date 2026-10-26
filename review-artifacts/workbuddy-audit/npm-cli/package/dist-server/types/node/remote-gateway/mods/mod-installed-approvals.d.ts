import { type SettingsManager } from '../../settings/settings-protocol';
export interface InstalledResourceBinding {
    root: string;
    sourceHash: string;
    indexHash: string;
    format?: 1 | 2;
}
export interface InstalledModApprovals {
    get(): Promise<Record<string, string>>;
    update(change: (current: Record<string, string>) => Record<string, string>): Promise<void>;
    resources?(): Promise<Record<string, InstalledResourceBinding>>;
    bind?(key: string, binding: InstalledResourceBinding): Promise<void>;
    retainedResources?(): Promise<InstalledResourceBinding[]>;
}
/** User source approval and its derived index binding share the existing settings transaction. */
export declare function createInstalledModApprovals(settings: Pick<SettingsManager, 'get' | 'update' | 'readUserConfigLayer'>): InstalledModApprovals;
export declare function assertInstalledResourceBinding(value: InstalledResourceBinding): void;
