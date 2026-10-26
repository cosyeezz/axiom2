export declare const ENV_KEY_CODEBUDDY_SESSION_HISTORY_CLEANUP = "CODEBUDDY_SESSION_HISTORY_CLEANUP";
/**
 * Session history cleanup is opt-in: only an explicit `1` / `true` enables it, so a host
 * that forgets the env never loses transcripts (issue #145446). The interactive entries
 * (`bin/codebuddy` TUI bundle, `bun/entry.js`) default it to `1`.
 */
export declare function isSessionHistoryCleanupEnabled(envValue?: string | undefined): boolean;
