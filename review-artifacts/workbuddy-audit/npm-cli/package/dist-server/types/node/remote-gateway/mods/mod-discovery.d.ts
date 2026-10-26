export interface DiscoveryItem {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    revision: number;
    enabled: boolean;
    role?: string;
    version?: number;
    installed?: boolean;
}
export interface DiscoveryPage {
    items: DiscoveryItem[];
    total: number;
    nextCursor: string | null;
}
/** Stateless keyset pagination: a changed catalog/query cannot silently skip results. */
export declare function discoverMods(items: DiscoveryItem[], request?: unknown, ranking?: Map<string, number>): DiscoveryPage;
/** One source-free index per service. MiniSearch owns token matching and ranking. */
export declare class ModDiscoveryIndex {
    private signature;
    private index?;
    search(items: DiscoveryItem[], request?: unknown): Promise<DiscoveryPage>;
}
