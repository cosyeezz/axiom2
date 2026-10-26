import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { AuthoredModDefinition } from './authored-mod-protocol';
import type { ComponentReader } from './component-package';
import type { ComponentService } from './component-service';
/** Expands references with the existing visual engine; no second business runtime. */
export declare class ResidentComposition {
    private readonly components;
    private readonly sessionId;
    private readonly plugin;
    private readonly references;
    private readonly invalidate;
    private readonly resolver?;
    private view?;
    private displayedActions;
    private unsubscribe?;
    private writing;
    private closed;
    constructor(components: ComponentService, sessionId: string, plugin: string, references: AuthoredModDefinition['components'], invalidate: () => void, resolver?: ComponentReader | undefined);
    render(tree: unknown, registry: Mods.ViewRenderRegistry, viewport: Mods.ModViewViewport): Promise<Mods.ModViewFrame>;
    action(id: string): Mods.ModViewAction | undefined;
    act(id: string, value: unknown): Promise<void>;
    private prepare;
    private closeView;
    close(): Promise<void>;
}
