import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { ComponentService } from './component-service';
export type ComponentMessageSegment = {
    kind: 'markdown';
    text: string;
} | {
    kind: 'component';
    id: string;
    version: number;
    view: Mods.ModViewSnapshot;
};
/** Fixed reference syntax, never source code. Markdown parsing owns code fences and spans. */
export declare function resolveComponentMessage(sessionId: string, text: string, service: ComponentService, views: Mods.ModViewService): Promise<{
    segments: ComponentMessageSegment[];
    errors: Array<{
        reference: string;
        error: string;
    }>;
}>;
