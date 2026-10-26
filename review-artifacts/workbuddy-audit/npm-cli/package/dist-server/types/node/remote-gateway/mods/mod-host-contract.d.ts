declare global {
    var __CODEBUDDY_MODS_HOST_API__: string | undefined;
}
/** Progressive public signatures from the exact packaged CBC declarations, with selected reference closure. */
export declare function inspectModHostContract(provider: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
