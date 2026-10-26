export declare const MOD_PLACEMENTS: readonly ['chat', 'sidebar', 'dock', 'floating'];
export type ModPlacement = typeof MOD_PLACEMENTS[number];
export declare const MOD_MOUNT_LIMITS: Readonly<{
    minWidth: 120;
    maxWidth: 600;
    minHeight: 120;
    maxHeight: 1200;
    maxPosition: 16384;
}>;
interface MountBase {
    id: string;
    title?: string;
    placement: ModPlacement;
    width: number;
    /** Omitted/null fits content; a numeric height is the user's resized panel frame. */
    height?: number | null;
    props: Record<string, unknown>;
    position?: {
        x: number;
        y: number;
    };
    collapsed?: boolean;
    chrome?: 'panel' | 'minimal';
}
export type ModMount = MountBase & ({
    kind?: 'resident';
    plugin: string;
    component?: never;
} | {
    kind: 'component';
    component: {
        id: string;
        version?: number;
        revision?: number;
    };
    plugin?: never;
});
export interface ComponentMountRef {
    id: string;
    version?: number;
    revision?: number;
}
/** Draft mounts follow the current revision; published mounts stay pinned. */
export declare function componentMountSelection(component: ComponentMountRef): string;
export declare function modMountSource(mount: ModMount): string;
/** Legacy plugin mounts remain valid; component mounts pin either a published version or a draft revision. */
export declare function parseModMount(value: unknown): ModMount;
export {};
//# sourceMappingURL=mod-mount.d.ts.map