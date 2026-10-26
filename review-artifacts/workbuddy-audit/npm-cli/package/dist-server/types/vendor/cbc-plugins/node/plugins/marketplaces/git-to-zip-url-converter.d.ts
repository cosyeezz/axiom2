/**
 * A single platform's rule for translating a Git repository URL to a ZIP
 * download URL. Rules are matched by hostname and applied in registration
 * order (newest first, see {@link GitToZipUrlConverter.registerRule}).
 */
export interface GitPlatformRule {
    /** Human-readable rule identifier, used in logs and tests. */
    readonly name: string;
    /** Return true when this rule applies to the given lower-cased hostname. */
    match(hostname: string): boolean;
    /**
     * Build the ZIP download URL.
     *
     * @param host Host with optional port, as returned by `URL#host`.
     * @param pathname Repository pathname with leading `/` and no trailing `/`.
     */
    convert(host: string, pathname: string): string;
}
/**
 * Converts Git-style references (http(s) URLs, SSH URLs, or `owner/repo`
 * shorthand) into archive download URLs understood by {@link ZipMarketplace}.
 *
 * Rule set is intentionally aligned with the reference table in
 * `packages/agent-craft/src/common/plugin/plugin-manager.ts` so the two
 * implementations stay behaviour-compatible.
 *
 * The converter does not know whether git is available; that decision is
 * made by {@link GitFallbackCoordinator}.
 */
export declare class GitToZipUrlConverter {
    private readonly rules;
    /**
     * Register an additional rule. Newer rules take precedence over built-ins
     * so callers can override default behaviour for a specific host.
     */
    registerRule(rule: GitPlatformRule): void;
    /**
     * Convert a Git reference to a ZIP archive URL.
     *
     * Accepts:
     * - `https://host/owner/repo` / `https://host/owner/repo.git`
     * - `git@host:owner/repo(.git)?`
     * - `owner/repo` shorthand (assumed to be GitHub)
     *
     * Returns `undefined` when the host is not recognised or the input is
     * not parseable as any of the accepted forms.
     */
    convert(input: string): string | undefined;
    private normaliseToHttpUrl;
}
//# sourceMappingURL=git-to-zip-url-converter.d.ts.map