export declare const AUTHORED_MOD_SCHEMAS: {
    AuthoredModPatch: {
        type: string;
        additionalProperties: boolean;
        description: string;
        properties: {
            files: {
                type: string;
                additionalProperties: {
                    type: string[];
                };
            };
        };
    };
    AuthoredModApplyRequest: {
        type: string;
        additionalProperties: boolean;
        description: string;
        oneOf: ({
            required: string[];
            not: {
                required: string[];
                anyOf?: undefined;
            };
        } | {
            required: string[];
            not: {
                anyOf: {
                    required: string[];
                }[];
                required?: undefined;
            };
        })[];
        properties: {
            definition: {
                $ref: string;
            };
            patch: {
                $ref: string;
            };
            revision: {
                type: string;
                minimum: number;
            };
            trustedHash: {
                type: string;
            };
            view: {
                enum: string[];
            };
        };
    };
    AuthoredModSaveRequest: {
        type: string;
        additionalProperties: boolean;
        oneOf: {
            required: string[];
            not: {
                required: string[];
            };
        }[];
        properties: {
            definition: {
                $ref: string;
            };
            patch: {
                $ref: string;
            };
            revision: {
                type: string;
                minimum: number;
            };
            view: {
                enum: string[];
            };
        };
    };
    AuthoredModDefinition: {
        type: string;
        additionalProperties: boolean;
        required: string[];
        anyOf: {
            required: string[];
        }[];
        properties: {
            name: {
                type: string;
            };
            description: {
                type: string;
            };
            entry: {
                type: string;
            };
            client: {
                type: string;
                minLength: number;
                maxLength: number;
                description: string;
            };
            files: {
                type: string;
                additionalProperties: {
                    type: string;
                };
            };
            options: {
                type: string;
                additionalProperties: boolean;
            };
            usage: {
                type: string;
            };
            appearance: {
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
            category: {
                type: string;
                enum: string[];
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
            storage: {
                type: string;
                additionalProperties: boolean;
                properties: {
                    global: {
                        type: string;
                        additionalProperties: boolean;
                    };
                    session: {
                        type: string;
                        additionalProperties: boolean;
                    };
                };
            };
        };
    };
};
