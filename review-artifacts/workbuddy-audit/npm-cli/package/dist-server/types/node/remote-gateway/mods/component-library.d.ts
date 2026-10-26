import type { AuthoredModDefinition } from './authored-mod-protocol';
import type { ComponentDefinition, ComponentLibraryRole, UserComponent } from './component-protocol';
export interface LibraryDependency {
    id: string;
    version: number;
    slot: string;
}
export interface LibraryConsumer {
    kind: 'component' | 'resident';
    id: string;
    name: string;
    revision: number;
    version?: number;
    installed?: boolean;
    dependencies: LibraryDependency[];
}
export interface LibraryResident {
    id: string;
    revision: number;
    definition: AuthoredModDefinition;
    installed?: boolean;
}
export interface ComponentLibraryItem {
    id: string;
    name: string;
    description: string;
    category: string;
    tags: string[];
    role: ComponentLibraryRole;
    enabled: boolean;
    revision: number;
    updatedAt: number;
    versions: Array<{
        version: number;
        hash: string;
        publishedAt: number;
        name: string;
        usage: string;
        propsSchema: ComponentDefinition['propsSchema'];
        initialProps: ComponentDefinition['initialProps'];
        stateScope: 'view' | 'session' | 'global';
        dependencies: LibraryDependency[];
    }>;
    dependencies: LibraryDependency[];
    usedBy: Array<Omit<LibraryConsumer, 'dependencies'> & {
        direct: boolean;
    }>;
}
export declare function definitionDependencies(definition: Pick<ComponentDefinition, 'components' | 'blueprint'>): LibraryDependency[];
/** Derived from actual version declarations, including installed code rather than just a newer draft. */
export declare function componentLibrary(components: UserComponent[], residents?: LibraryResident[]): {
    components: ComponentLibraryItem[];
    consumers: LibraryConsumer[];
};
