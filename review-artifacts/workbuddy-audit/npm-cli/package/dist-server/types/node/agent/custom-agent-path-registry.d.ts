/**
 * Maps loaded custom-agent names to their original markdown file paths.
 *
 * `CustomAgentsProductProvider` scans `.codebuddy/agents` recursively and is the
 * only place that knows the real file (including subdirectories and files whose
 * frontmatter `name` differs from the file name). It records that path here so
 * `CustomAgentManager` can delete/open the exact file without re-scanning or
 * carrying agent-cli internals on the shared product `Agent` type.
 *
 * The registry is rebuilt on every product provider pass (`clear()` then `set()`),
 * so it cannot go stale across config hot-reloads.
 */
export declare class CustomAgentPathRegistry {
    private readonly paths;
    set(name: string, filePath: string): void;
    get(name: string): string | undefined;
    delete(name: string): void;
    clear(): void;
}
