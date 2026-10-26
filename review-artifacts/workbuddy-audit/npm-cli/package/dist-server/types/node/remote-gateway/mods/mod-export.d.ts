import { type PluginManager } from '../../../vendor/cbc-plugins/node/index.js';
import { type AuthoredModStore } from './authored-mod-store';
import { type ComponentStore } from './component-store';
import type { SkinService } from './skin-service';
export declare const MOD_EXPORT_LIMITS: Readonly<{
    bytes: number;
    pending: 2;
}>;
export interface ModExportArtifact {
    filename: string;
    mimeType: 'application/gzip' | 'application/json';
    bytes: number;
    sha256: string;
    base64: string;
}
interface Dependencies {
    session(id: string): Promise<unknown>;
    authored: AuthoredModStore;
    components: ComponentStore;
    skins: SkinService;
    plugins: Pick<PluginManager, 'getInstalledPlugins'>;
}
/** Download preparation only. Existing package/compiler/store owners retain installation and execution. */
export declare class ModExportService {
    private readonly deps;
    private pending;
    constructor(deps: Dependencies);
    export(sessionId: string, request: unknown, signal?: AbortSignal): Promise<ModExportArtifact>;
    private only;
    private installed;
}
export {};
