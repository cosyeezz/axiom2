import type { ComponentBlueprint, ModAppearance } from '../../../../cbc-shared/common/index.js';
import type { JsonObject, JsonValue } from '../../../../cbc-worker/node/protocol/index.js';
export declare const MOD_VIEW_PROTOCOL = 1;
export declare const MOD_VIEW_LIMITS: Readonly<{
    maxViews: 32;
    maxViewsPerSession: 8;
    maxMods: 8;
    maxPending: 16;
    maxInputBytes: number;
    maxFrameBytes: number;
    maxNodes: 2000;
    maxDepth: 32;
    maxActions: 512;
    maxEvents: 64;
    maxEventBytes: number;
    maxSubscribers: 8;
    maxIdempotencyKeys: 128;
    maxTimers: 32;
    minTimerMs: 50;
    maxStoreBytes: number;
    maxNoticesPerSecond: 32;
    operationMs: 15000;
    idleMs: number;
    maxOccurrences: 128;
}>;
export type ModViewEventName = 'frame' | 'notice' | 'failed' | 'closed';
export type ModViewActionKind = 'press' | 'input' | 'select' | 'focus' | 'scroll';
export interface ModViewViewport {
    columns: number;
    rows: number;
    isFullscreen: boolean;
}
export interface ModViewElement {
    type: string;
    props: JsonObject;
    children: ModViewElement[];
}
export interface ModViewAction {
    id: string;
    kind: ModViewActionKind;
    plugin: string;
    element: string;
    /** Stable callback occurrence identity across frame revisions and list filtering. */
    control?: string;
}
export interface ModViewFrame {
    tree: ModViewElement | null;
    actions: ModViewAction[];
    appearance?: ModAppearance;
    /** Durable blueprint state, returned with the frame so the host persists it before replying. */
    state?: Record<string, JsonObject>;
    /** Internal validation data for all occurrences, including temporary views. Never sent to a browser. */
    componentState?: Record<string, JsonObject[]>;
    /** Actual props used by composed occurrences; host schema validation only. */
    componentProps?: Record<string, JsonObject[]>;
}
/** Storage revisions are separate from render revisions and never supplied by the browser. */
export interface ModViewStateEntry {
    revision: number;
    value: JsonObject;
}
export type ModViewState = Record<string, ModViewStateEntry>;
export interface ModViewMod {
    id: string;
    name: string;
    version?: string;
    description?: string;
    options: JsonObject;
    optionsSchema?: JsonObject;
    propsSchema?: JsonObject;
}
export interface ModViewCatalogIssue {
    id: string;
    error: string;
}
export interface ModViewSelection {
    id: string;
    options?: JsonObject;
}
export interface ModViewCreate {
    sessionId: string;
    mods: ModViewSelection[];
    props?: JsonObject;
    viewport?: ModViewViewport;
}
export interface ModViewPatch {
    revision: number;
    props?: JsonObject;
    viewport?: ModViewViewport;
}
export interface ModViewActionRequest {
    revision: number;
    actionId: string;
    requestId: string;
    value?: JsonValue;
}
export interface ModViewSnapshot extends ModViewFrame {
    id: string;
    sessionId: string;
    status: 'ready' | 'failed' | 'closed';
    revision: number;
    cursor: number;
    mods: ModViewSelection[];
    props: JsonObject;
    viewport: ModViewViewport;
    createdAt: number;
    expiresAt: number;
    error?: string;
}
export interface ModViewEvent {
    cursor: number;
    type: ModViewEventName;
    data: JsonObject;
}
export interface CompiledViewMod {
    appearance?: ModAppearance;
    id: string;
    name: string;
    root: string;
    options: JsonObject;
    modules: string[];
    blueprint?: ComponentBlueprint;
    /** Durable blueprint state or source $.store, isolated by component occurrence. */
    stateKey?: string;
    stateSchema?: JsonObject;
    propsSchema?: JsonObject;
    componentId?: string;
    /** Dependency template materialized separately for each keyed list occurrence. */
    repeated?: boolean;
    references?: Record<string, string>;
    referenceDefaults?: Record<string, JsonObject>;
    dependencies?: CompiledViewMod[];
}
export interface ViewWorkerInit {
    viewId: string;
    sessionId: string;
    cwd: string;
    mods: CompiledViewMod[];
    props: JsonObject;
    viewport: ModViewViewport;
    state?: Record<string, JsonObject>;
}
export interface ModViewWorkerProtocol {
    host: {
        requests: {
            init: {
                payload: ViewWorkerInit;
                reply: ModViewFrame;
            };
            inspect: {
                payload: ViewWorkerInit;
                reply: {
                    events: string[];
                };
            };
            render: {
                payload: {
                    props: JsonObject;
                    viewport: ModViewViewport;
                };
                reply: ModViewFrame;
            };
            restore: {
                payload: {
                    state: Record<string, JsonObject>;
                };
                reply: ModViewFrame;
            };
            action: {
                payload: {
                    actionId: string;
                    value?: JsonValue;
                };
                reply: ModViewFrame;
            };
            tick: {
                payload: {
                    timerId: string;
                };
                reply: ModViewFrame;
            };
            skipTick: {
                payload: {
                    timerId: string;
                };
                reply: null;
            };
            close: {
                payload: Record<string, never>;
                reply: null;
            };
        };
        notices: Record<string, never>;
    };
    guest: {
        requests: Record<string, never>;
        notices: {
            invalidate: Record<string, never>;
            tick: {
                timerId: string;
            };
            notice: {
                kind: string;
                plugin: string;
                text: string;
            };
        };
    };
}
//# sourceMappingURL=protocol.d.ts.map