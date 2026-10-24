/** Read-only candidate paths and their identity digest; ownership is rechecked at deletion. */
export type CleanupScope = { paths: string[]; revision: string };
