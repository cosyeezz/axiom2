/**
 * Host-advertised CLI capabilities.
 *
 * Hosts spawn agent-cli with CODEBUDDY_CLI_CAPABILITIES (comma-separated,
 * dot-hierarchical bits). CLI reads the bits live; unknown future bits are
 * ignored. This is a separate channel from CODEBUDDY_HOST_CAPABILITIES, which
 * advertises host UI capabilities to builtin-plugin MCP children.
 *
 * WorkBuddy Desktop keeps its existing host gates. Other hosts opt in by
 * declaring the bits they want — CLI does not branch on product names.
 */
export declare const CLI_CAPABILITIES_ENV = "CODEBUDDY_CLI_CAPABILITIES";
export declare const CLI_CAPABILITY: {
    /**
     * FileSafety package: fileBackup + safe-delete, unsafe find -delete approval,
     * plus the macOS brokered runtime coverage for sandbox shell writes/deletes.
     */
    readonly FILE_SAFETY: "file.safety";
};
/**
 * Live-read a capability bit from CODEBUDDY_CLI_CAPABILITIES.
 */
export declare function hasCliCapability(capability: string): boolean;
/**
 * FileSafety is on for WorkBuddy Desktop (unchanged host gate) or any host
 * that declared the file.safety bit.
 */
export declare function isFileSafetyEnabled(): boolean;
