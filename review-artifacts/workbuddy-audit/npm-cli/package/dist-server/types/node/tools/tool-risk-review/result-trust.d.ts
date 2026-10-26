export declare const TOOL_RESULT_WRAPPER_VERSION = "2";
export declare function createUntrustedToolResultBoundary(input: {
    toolName: string;
    toolCallId: string;
    serializedContent: string;
}): {
    begin: string;
    end: string;
};
export declare function wrapUntrustedToolResultText(input: {
    toolName: string;
    toolCallId: string;
    text: string;
}): string;
export declare function createWrappedResultHash(wrappedText: string, hmacKey?: Buffer): string;
