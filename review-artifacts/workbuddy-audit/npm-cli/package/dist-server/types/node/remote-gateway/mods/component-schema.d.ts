export declare const COMPONENT_SCHEMAS: {
    ModStyle: Record<string, unknown>;
    ComponentDefinition: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            name: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            description: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            entry: {
                type: string;
            };
            files: {
                type: string;
                maxProperties: number;
                additionalProperties: {
                    type: string;
                };
            };
            propsSchema: {
                type: string;
                additionalProperties: boolean;
            };
            initialProps: {
                type: string;
                additionalProperties: boolean;
            };
            usage: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            category: {
                enum: ("list" | "other" | "media" | "form" | "tracker" | "calculator" | "dashboard" | "chart" | "utility")[];
                description: string;
            };
            tags: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    minLength: number;
                    maxLength: number;
                };
            };
            persist: {
                type: string;
                description: string;
            };
            stateScope: {
                enum: string[];
                description: string;
            };
            stateSchema: {
                type: string;
                additionalProperties: boolean;
            };
            appearance: {
                $ref: string;
            };
            blueprint: {
                $ref: string;
            };
            components: {
                type: string;
                maxProperties: number;
                propertyNames: {
                    pattern: string;
                    not: {
                        enum: string[];
                    };
                };
                additionalProperties: {
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
            };
        };
        anyOf: {
            required: string[];
        }[];
    };
    UserComponent: {
        type: string;
        required: string[];
        properties: {
            id: {
                type: string;
                pattern: string;
            };
            revision: {
                type: string;
                minimum: number;
            };
            enabled: {
                type: string;
            };
            draft: {
                $ref: string;
            };
            updatedAt: {
                type: string;
            };
            libraryRole: {
                enum: string[];
            };
            versions: {
                type: string;
                items: {
                    type: string;
                    required: string[];
                    properties: {
                        version: {
                            type: string;
                            minimum: number;
                        };
                        hash: {
                            type: string;
                        };
                        definition: {
                            $ref: string;
                        };
                        publishedAt: {
                            type: string;
                        };
                    };
                };
            };
        };
    };
    ComponentDiagnostic: {
        type: string;
        required: string[];
        properties: {
            phase: {
                enum: string[];
            };
            message: {
                type: string;
            };
        };
    };
    ComponentInstance: {
        type: string;
        required: string[];
        properties: {
            view: {
                $ref: string;
            };
            reference: {
                type: string;
                required: string[];
                properties: {
                    type: {
                        const: string;
                    };
                    componentId: {
                        type: string;
                        pattern: string;
                    };
                    version: {
                        type: string;
                        minimum: number;
                    };
                    viewId: {
                        type: string;
                    };
                };
            };
            markup: {
                type: string;
            };
        };
    };
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
                            pattern: string;
                            enum?: undefined;
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
        } | {
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
                        const: string;
                        not?: undefined;
                    };
                };
            };
            then: {
                required: string[];
                properties?: undefined;
            };
            else: {
                not: {
                    required: string[];
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
