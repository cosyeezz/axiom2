import type { ComponentDefinition, UserComponent } from './component-protocol';
/** Narrow read-only view of a component source: the global ComponentStore or an immutable package bundle. */
export interface ComponentReader {
    get(id: string): Promise<Pick<UserComponent, 'id' | 'enabled' | 'versions'>>;
}
export interface PackageComponentRef {
    id: string;
    version: number;
}
export interface PackageComponentEntry {
    id: string;
    version: number;
    hash: string;
    definition: ComponentDefinition;
}
export interface PackageComponents {
    format: 1;
    references: Record<string, PackageComponentRef>;
    components: PackageComponentEntry[];
}
export declare const PACKAGE_COMPONENT_MANIFEST = ".cbc-components/manifest.json";
export declare const PACKAGE_COMPONENT_LIMITS: Readonly<{
    entries: 128;
    bytes: number;
}>;
/** Only a data file inside the dedicated bundle directory is accepted. */
export declare function packageComponentPath(path: unknown): string;
/** Transitive pinned closure of published versions; the read graph is authoritative and nothing is flattened or rewritten. */
export declare function exportComponentClosure(references: Record<string, PackageComponentRef>, reader: ComponentReader): Promise<PackageComponents>;
/** Strict parse: checksums, pinned closure, reachability, acyclicity and bounds are enforced before anything is usable. */
export declare function parsePackageComponents(text: string): PackageComponents;
export declare function parsePackageComponentFiles(files: ReadonlyMap<string, Buffer>, path: unknown): PackageComponents;
/** Immutable package-local component source. It never reads or writes the user's global library. */
export declare class PackageComponentResolver implements ComponentReader {
    private readonly bundle;
    constructor(bundle: PackageComponents);
    get references(): Record<string, PackageComponentRef>;
    get(id: string): Promise<Pick<UserComponent, 'id' | 'enabled' | 'versions'>>;
}
/** Reads the declared bundle from an installed ordinary package root without following symlinks. */
export declare function loadPackageComponents(root: string, path: unknown): Promise<PackageComponentResolver>;
