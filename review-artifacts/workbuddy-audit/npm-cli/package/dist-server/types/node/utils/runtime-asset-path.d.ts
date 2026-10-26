/** Host packaging adapter. Currently used for the standalone ripgrep executable. */
export type RuntimeAssetPathResolver = (asset: 'ripgrep', defaultPath: string) => string;
/** The in-process Harness owner installs this before startup and releases it after shutdown. */
export declare function bindRuntimeAssetPathResolver(resolve: RuntimeAssetPathResolver): () => void;
export declare function resolveRuntimeAssetPath(asset: 'ripgrep', defaultPath: string): string;
