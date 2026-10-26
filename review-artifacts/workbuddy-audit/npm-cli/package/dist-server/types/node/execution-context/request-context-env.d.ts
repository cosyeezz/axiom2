export declare const W3C_PROPAGATION_ENV_KEYS: readonly ["TRACEPARENT", "TRACESTATE", "BAGGAGE"];
export declare const REQUEST_SCOPED_ENV_KEYS: readonly ["TRACEPARENT", "TRACESTATE", "BAGGAGE", "CODEBUDDY_CONVERSATION_REQUEST_ID", "CODEBUDDY_CONVERSATION_MESSAGE_ID", "CODEBUDDY_ROOT_REQUEST_ID", "CODEBUDDY_TOOL_CALL_ID", "CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID", "CODEBUDDY_SANDBOX_BROKER_TRACE_ID"];
export declare function scrubRequestContextFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, platform?: NodeJS.Platform): void;
