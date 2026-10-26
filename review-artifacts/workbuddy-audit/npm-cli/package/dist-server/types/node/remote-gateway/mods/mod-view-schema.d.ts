export declare const MOD_VIEW_SCHEMAS: {
    ModViewMod: {
        type: string;
        required: string[];
        properties: {
            id: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            name: {
                type: string;
            };
            version: {
                type: string;
            };
            description: {
                type: string;
            };
            options: {
                type: string;
                additionalProperties: boolean;
            };
            optionsSchema: {
                type: string;
                additionalProperties: boolean;
            };
            propsSchema: {
                type: string;
                additionalProperties: boolean;
            };
        };
    };
    ModViewCatalog: {
        type: string;
        required: string[];
        properties: {
            mods: {
                type: string;
                items: {
                    $ref: string;
                };
            };
            errors: {
                type: string;
                items: {
                    type: string;
                    required: string[];
                    properties: {
                        id: {
                            type: string;
                            minLength: number;
                            maxLength: number;
                            pattern: string;
                        };
                        error: {
                            type: string;
                        };
                    };
                };
            };
            limits: {
                type: string;
                additionalProperties: {
                    type: string;
                    minimum: number;
                };
            };
        };
    };
    ModViewViewport: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            columns: {
                type: string;
                minimum: number;
                maximum: number;
            };
            rows: {
                type: string;
                minimum: number;
                maximum: number;
            };
            isFullscreen: {
                type: string;
            };
        };
    };
    ModViewElement: {
        type: string;
        required: string[];
        properties: {
            type: {
                type: string;
                enum: string[];
            };
            props: {
                type: string;
                additionalProperties: boolean;
            };
            children: {
                type: string;
                items: {
                    $ref: string;
                };
            };
        };
    };
    ModViewSelection: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            id: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            options: {
                type: string;
                additionalProperties: boolean;
            };
        };
    };
    ModViewAction: {
        type: string;
        required: string[];
        properties: {
            id: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            kind: {
                enum: string[];
            };
            plugin: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            element: {
                type: string;
            };
            control: {
                type: string;
            };
        };
    };
    ModViewSnapshot: {
        type: string;
        required: string[];
        properties: {
            id: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            sessionId: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            status: {
                enum: string[];
            };
            revision: {
                type: string;
                minimum: number;
            };
            cursor: {
                type: string;
                minimum: number;
            };
            mods: {
                type: string;
                items: {
                    $ref: string;
                };
            };
            props: {
                type: string;
                additionalProperties: boolean;
            };
            viewport: {
                $ref: string;
            };
            tree: {
                anyOf: ({
                    $ref: string;
                } | {
                    type: string;
                })[];
            };
            actions: {
                type: string;
                items: {
                    $ref: string;
                };
            };
            createdAt: {
                type: string;
            };
            expiresAt: {
                type: string;
            };
            error: {
                type: string;
            };
            appearance: {
                $ref: string;
            };
        };
    };
    ModViewCreate: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            sessionId: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            mods: {
                type: string;
                minItems: number;
                maxItems: number;
                items: {
                    $ref: string;
                };
            };
            props: {
                type: string;
                additionalProperties: boolean;
            };
            viewport: {
                $ref: string;
            };
        };
    };
    ModViewPatch: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            revision: {
                type: string;
                minimum: number;
            };
            props: {
                type: string;
                additionalProperties: boolean;
            };
            viewport: {
                $ref: string;
            };
        };
        anyOf: {
            required: string[];
        }[];
    };
    ModViewActionRequest: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            revision: {
                type: string;
                minimum: number;
            };
            actionId: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            requestId: {
                type: string;
                minLength: number;
                maxLength: number;
                pattern: string;
            };
            value: {};
        };
    };
};
