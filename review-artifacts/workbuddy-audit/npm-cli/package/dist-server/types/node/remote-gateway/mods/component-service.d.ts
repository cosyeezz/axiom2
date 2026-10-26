import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import { componentLibrary, type LibraryResident } from './component-library';
import type { ComponentReader } from './component-package';
import { type ComponentDefinition, type ComponentInstance, type ComponentPreview, type UserComponent } from './component-protocol';
import { ComponentStore } from './component-store';
import { type DiscoveryPage } from './mod-discovery';
export declare class ComponentService {
    readonly store: ComponentStore;
    private readonly catalog;
    readonly views: Mods.ModViewService;
    private readonly changed;
    private readonly residents;
    private readonly discovery;
    constructor(store: ComponentStore, catalog: Mods.ModViewCatalog, views: Mods.ModViewService, changed?: () => void, residents?: () => Promise<LibraryResident[]>);
    library(sessionId: string): Promise<ReturnType<typeof componentLibrary>>;
    search(sessionId: string, request: unknown): Promise<DiscoveryPage>;
    describe(sessionId: string, id: string, request?: unknown): Promise<Record<string, unknown>>;
    classify(sessionId: string, id: string, request: unknown): Promise<UserComponent>;
    compose(sessionId: string, id: string, request: unknown): Promise<UserComponent>;
    /** One visual Worker expands all pinned children of a resident view. */
    openResidentComposition(sessionId: string, stateId: string, components: NonNullable<ComponentDefinition['components']>, props: ComponentDefinition['initialProps'], viewport: Mods.ModViewViewport, resolver?: ComponentReader): Promise<Mods.ModViewSnapshot>;
    list(sessionId: string): Promise<{
        components: UserComponent[];
    }>;
    get(sessionId: string, id: string): Promise<UserComponent>;
    contract(sessionId: string, request?: unknown): Promise<Record<string, unknown>>;
    examples(sessionId: string): Promise<Record<string, unknown>>;
    saveExample(sessionId: string, id: string, request: unknown): Promise<UserComponent>;
    listViews(sessionId: string, id: string): Promise<Record<string, unknown>>;
    viewOperation(sessionId: string, id: string, operation: 'viewGet' | 'viewAction' | 'dropView', request: unknown): Promise<Record<string, unknown>>;
    save(sessionId: string, id: string, request: unknown): Promise<UserComponent>;
    preview(sessionId: string, id: string, revision: number, signal?: AbortSignal): Promise<ComponentPreview>;
    openPreview(sessionId: string, id: string, request: unknown): Promise<Mods.ModViewSnapshot>;
    publish(sessionId: string, id: string, request: unknown, signal?: AbortSignal): Promise<UserComponent>;
    setEnabled(sessionId: string, id: string, request: unknown): Promise<UserComponent>;
    delete(sessionId: string, id: string, request: unknown): Promise<void>;
    instantiate(sessionId: string, id: string, request: unknown): Promise<ComponentInstance>;
}
/** Published component selections use immutable versions; draft selections pin their revision. */
export declare function componentCatalog(base: Mods.ModViewCatalog, store: ComponentStore): Mods.ModViewCatalog;
