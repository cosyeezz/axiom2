export declare const SKIN_SCHEMAS: {
    SkinColors: {
        type: string;
        additionalProperties: boolean;
        properties: {
            [k: string]: {
                type: string;
                maxLength: number;
            };
        };
    };
    SkinTokenValues: {
        type: string;
        maxProperties: 128;
        propertyNames: {
            type: string;
            maxLength: 80;
            pattern: string;
        };
        additionalProperties: {
            type: string;
            minLength: number;
            maxLength: 512;
        };
        description: string;
    };
    SkinTokens: {
        type: string;
        additionalProperties: boolean;
        properties: {
            light: {
                $ref: string;
            };
            dark: {
                $ref: string;
            };
        };
    };
    ModMount: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            id: {
                type: string;
            };
            kind: {
                enum: string[];
            };
            plugin: {
                type: string;
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
                    revision: {
                        type: string;
                        minimum: number;
                    };
                };
                oneOf: {
                    required: string[];
                    not: {
                        required: string[];
                    };
                }[];
            };
            title: {
                type: string;
                minLength: number;
                maxLength: number;
            };
            placement: {
                enum: ("chat" | "dock" | "sidebar" | "floating")[];
            };
            width: {
                type: string;
                minimum: 120;
                maximum: 600;
            };
            height: {
                anyOf: ({
                    type: string;
                    minimum: 120;
                    maximum: 1200;
                } | {
                    type: string;
                    minimum?: undefined;
                    maximum?: undefined;
                })[];
                description: string;
            };
            props: {
                type: string;
            };
            chrome: {
                enum: string[];
            };
            collapsed: {
                type: string;
            };
            position: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    x: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                    y: {
                        type: string;
                        minimum: number;
                        maximum: number;
                    };
                };
            };
        };
        oneOf: {
            required: string[];
            properties: {
                kind: {
                    const: string;
                };
            };
            not: {
                required: string[];
            };
        }[];
    };
    SkinBackground: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        properties: {
            surfaceBlur: {
                type: string;
                minimum: number;
                maximum: number;
            };
            image: {
                type: string;
                maxLength: number;
            };
            size: {
                enum: string[];
            };
            position: {
                enum: string[];
            };
            opacity: {
                type: string;
                minimum: number;
                maximum: number;
            };
            overlay: {
                type: string;
            };
            overlayOpacity: {
                type: string;
                minimum: number;
                maximum: number;
            };
            panelOpacity: {
                type: string;
                minimum: number;
                maximum: number;
            };
            chatOpacity: {
                type: string;
                minimum: number;
                maximum: number;
            };
        };
    };
    ModAppearance: {
        type: string;
        additionalProperties: boolean;
        properties: {
            light: {
                $ref: string;
            };
            dark: {
                $ref: string;
            };
            font: {
                enum: string[];
            };
            radius: {
                type: string;
                minimum: number;
                maximum: number;
            };
            background: {
                $ref: string;
            };
        };
    };
    UiSkin: {
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
                maxLength: number;
            };
            light: {
                $ref: string;
            };
            dark: {
                $ref: string;
            };
            tokens: {
                $ref: string;
            };
            font: {
                enum: string[];
            };
            radius: {
                type: string;
                minimum: number;
                maximum: number;
            };
            background: {
                $ref: string;
            };
            welcome: {
                type: string;
                additionalProperties: boolean;
                required: string[];
                properties: {
                    mode: {
                        enum: string[];
                    };
                    image: {
                        type: string;
                        maxLength: number;
                    };
                };
            };
        };
    };
    ModCustomizationSnapshot: {
        type: string;
        required: string[];
        properties: {
            revision: {
                type: string;
                minimum: number;
            };
            activeId: {
                anyOf: ({
                    type: string;
                    pattern: string;
                } | {
                    type: string;
                })[];
            };
            skins: {
                type: string;
                maxItems: number;
                items: {
                    type: string;
                    properties: {
                        id: {
                            type: string;
                            pattern: string;
                        };
                        revision: {
                            type: string;
                            minimum: number;
                        };
                        definition: {
                            $ref: string;
                        };
                        updatedAt: {
                            type: string;
                        };
                    };
                };
            };
            mounts: {
                type: string;
                items: {
                    $ref: string;
                };
            };
        };
    };
};
