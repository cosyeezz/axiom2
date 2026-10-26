export type BlueprintValue = string | number | boolean | null | BlueprintValue[] | {
    [key: string]: BlueprintValue;
};
export type BlueprintTag = 'Box' | 'Text' | 'Button' | 'Input' | 'Select' | 'Markdown' | 'Code' | 'Link' | 'Image' | 'Svg' | 'Raster' | 'Fragment';
export interface BlueprintBinding {
    $bind: 'props' | 'state' | 'event' | 'item' | 'index';
    path: string;
    fallback?: BlueprintValue;
    /** Render one of two literals depending on the bound value, so lists can show state without scripting. */
    truthy?: BlueprintValue;
    falsy?: BlueprintValue;
}
export type BlueprintProperty = BlueprintValue | BlueprintBinding;
export interface BlueprintAction {
    type: 'set' | 'increment' | 'decrement' | 'multiply' | 'toggle' | 'push' | 'removeAt';
    path: string;
    value?: BlueprintProperty;
    as?: 'number' | 'string';
}
export interface BlueprintNode {
    id: string;
    type: BlueprintTag | 'Component';
    props: Record<string, BlueprintProperty>;
    children: BlueprintNode[];
    events?: Partial<Record<'onPress' | 'onInput' | 'onSelect', BlueprintAction[]>>;
    component?: {
        id: string;
        version: number;
    };
    /** Repeat this node once per item of a state array; bindings may read item/index/itemPath. */
    map?: {
        $bind: 'state';
        path: string;
        key?: string;
        as?: string;
    };
    /** Hide this node when the bound value is falsy (empty arrays count as falsy). */
    when?: {
        $bind: 'state' | 'props' | 'item' | 'index';
        path: string;
        equals?: BlueprintValue;
    };
}
export interface ComponentBlueprint {
    format: 1;
    state: Record<string, BlueprintValue>;
    root: BlueprintNode;
}
export declare const BLUEPRINT_TAGS: readonly BlueprintTag[];
export declare const BLUEPRINT_LIMITS: Readonly<{
    nodes: 500;
    depth: 16;
    actionsPerEvent: 16;
    jsonDepth: 32;
    renderedNodes: 2000;
}>;
export declare const BLUEPRINT_EVENT_TAGS: Readonly<{
    onPress: "Button";
    onInput: "Input";
    onSelect: "Select";
}>;
export declare const BLUEPRINT_SCHEMAS: {
    BlueprintBinding: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            $bind: {
                enum: string[];
            };
            path: {
                type: string;
                description: string;
            };
            fallback: {};
            truthy: {};
            falsy: {};
        };
    };
    BlueprintAction: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            type: {
                enum: string[];
            };
            path: {
                type: string;
                minLength: number;
            };
            value: {};
            as: {
                enum: string[];
            };
        };
    };
    BlueprintNode: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            id: {
                type: string;
                pattern: string;
            };
            type: {
                enum: string[];
            };
            props: {
                type: string;
                description: string;
                propertyNames: {
                    pattern: string;
                    not: {
                        anyOf: ({
                            enum: string[];
                            pattern?: undefined;
                        } | {
                            enum?: undefined;
                            pattern: string;
                        })[];
                    };
                };
            };
            children: {
                type: string;
                maxItems: 500;
                items: {
                    $ref: string;
                };
            };
            events: {
                type: string;
                additionalProperties: boolean;
                properties: {
                    [k: string]: {
                        type: string;
                        maxItems: 16;
                        items: {
                            $ref: string;
                        };
                    };
                };
            };
            component: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    id: {
                        type: string;
                        pattern: string;
                    };
                    version: {
                        type: string;
                        minimum: number;
                    };
                };
            };
            map: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    $bind: {
                        const: string;
                    };
                    path: {
                        type: string;
                        minLength: number;
                    };
                    key: {
                        type: string;
                        description: string;
                    };
                    as: {
                        type: string;
                    };
                };
            };
            when: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    $bind: {
                        enum: string[];
                    };
                    path: {
                        type: string;
                    };
                    equals: {};
                };
            };
        };
        allOf: ({
            if: {
                properties: {
                    type: {
                        not: {
                            enum: string[];
                        };
                        const?: undefined;
                    };
                };
            };
            then: {
                properties: {
                    children: {
                        maxItems: number;
                    };
                };
                required?: undefined;
            };
            else?: undefined;
        } | {
            if: {
                properties: {
                    type: {
                        not?: undefined;
                        const: string;
                    };
                };
            };
            then: {
                properties?: undefined;
                required: string[];
            };
            else: {
                not: {
                    required: string[];
                };
            };
        } | {
            if: {
                properties: {
                    type: {
                        not: {
                            const: "Button" | "Input" | "Select";
                        };
                    };
                };
            };
            then: {
                properties: {
                    events: {
                        not: {
                            required: string[];
                        };
                    };
                };
            };
        })[];
    };
    ComponentBlueprint: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            format: {
                const: number;
            };
            state: {
                type: string;
                description: string;
            };
            root: {
                $ref: string;
            };
        };
    };
};
/** A source-free component document, shared by the editor and the Worker runtime. */
export declare function parseBlueprint(value: unknown): ComponentBlueprint;
export declare function blueprintReferences(blueprint: ComponentBlueprint): Array<{
    id: string;
    version: number;
}>;
export declare function readBlueprintPath(value: unknown, path: string): unknown;
export declare function resolveBlueprintProperty(value: BlueprintProperty, props: unknown, state: unknown, event?: unknown): BlueprintValue;
export interface BlueprintRenderElement {
    type: string;
    props: Record<string, unknown>;
    children: BlueprintRenderElement[];
}
export declare function renderBlueprint(blueprint: ComponentBlueprint, data: Record<string, unknown>, state: Record<string, BlueprintValue>, reference: (node: BlueprintNode, props: Record<string, BlueprintValue>, key: string) => Promise<BlueprintRenderElement>): Promise<BlueprintRenderElement>;
//# sourceMappingURL=component-blueprint.d.ts.map