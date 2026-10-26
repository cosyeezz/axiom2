import { ModelRequestProcessor, type ModelRequestWire } from './model-protocol';
/** Set by the fetch adapter: whether internal `extra_vars` may reach this endpoint. */
export declare const INTERNAL_METADATA_PASSTHROUGH_CONFIG_KEY = "allowInternalMetadataPassthrough";
/**
 * Sole writer of `extra_vars.initiator`, read from the trailing user message of the final
 * chat body. Runs after every body-rewriting processor and before the sensitive boundary
 * (9_998), which strips the `__codebuddy` initiator marks read here. Reporting only.
 */
export declare class MessageInitiatorRequestProcessor implements ModelRequestProcessor {
    readonly priority = 9000;
    readonly wires: readonly ModelRequestWire[];
    process(axiosConfig: any): Promise<void>;
}
