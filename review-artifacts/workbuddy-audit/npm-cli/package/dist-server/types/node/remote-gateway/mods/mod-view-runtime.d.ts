import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import { ComponentService } from './component-service';
import { SkinService } from './skin-service';
export declare class ModViewRuntime {
    private readonly sessionManager;
    private readonly pluginManager;
    private readonly fileLocks;
    private instance?;
    private componentInstance?;
    private skinInstance?;
    get skins(): SkinService;
    get service(): Mods.ModViewService;
    get components(): ComponentService;
    private initialize;
    close(): Promise<void>;
}
