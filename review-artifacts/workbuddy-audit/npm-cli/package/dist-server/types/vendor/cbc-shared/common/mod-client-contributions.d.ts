export interface ModDockContribution {
    id: string;
    label: {
        zh: string;
        en: string;
    };
}
export interface ModClientContributions {
    dockTabs?: ModDockContribution[];
    commands?: ModDockContribution[];
}
/** Approved manifest data advertises entry points without loading executable client code. */
export declare function parseModClientContributions(value: unknown): ModClientContributions | undefined;
//# sourceMappingURL=mod-client-contributions.d.ts.map