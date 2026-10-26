export declare const MOD_EXTERNALS: string[];
/** Compiler identity is available without initializing jiti/Babel on cache hits. */
export declare function modCompilerVersion(): string;
export interface ModBundle {
    code: string;
    inputs: string[];
    inputHashes?: Readonly<Record<string, string>>;
}
export interface ModCompilerFileSystem {
    readText(path: string): Promise<string>;
    resolve(specifier: string, importer?: string): Promise<string>;
}
export interface ModCompileOptions {
    target?: 'host' | 'browser';
    externals?: readonly string[];
    literalImportsOnly?: boolean;
}
/** Resolution only, never jiti.import/evalModule: package build cannot execute author code. */
export declare function createModDependencyResolver(entry: string, target: 'host' | 'browser'): Promise<(specifier: string, importer: string) => string>;
/**
 * Compile only: execution remains in the caller's hardened realm or explicit host channel.
 * jiti 2.7's import/evalModule APIs evaluate in the host (vm.runInThisContext), so
 * they cannot implement isolated mods. Its public transform/resolve APIs supply
 * the compiler and resolver; the small CJS graph below owns realm-local execution.
 */
export declare function bundleMod(entry: string, files?: ModCompilerFileSystem, options?: ModCompileOptions): Promise<ModBundle>;
/** Host execution uses the same compiled graph, with require anchored to the mod. */
export declare function asHostModule(code: string, entry: string): string;
//# sourceMappingURL=mod-compiler.d.ts.map