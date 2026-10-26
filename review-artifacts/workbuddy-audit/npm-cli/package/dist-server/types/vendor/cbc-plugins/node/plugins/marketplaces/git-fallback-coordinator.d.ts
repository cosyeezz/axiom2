import { Logger } from '@genie/telemetry';
import { MarketplaceSource } from '../plugin-protocol';
import { GitAvailabilityDetector } from './git-availability-detector';
import { GitToZipUrlConverter } from './git-to-zip-url-converter';
/**
 * Facade that decides whether a Git/Github marketplace source should be
 * silently rewritten to a Zip source because the local `git` executable is
 * not available.
 *
 * The rewrite is intentionally applied as early as possible in
 * {@link PluginManagerImpl.addMarketplace} — before the marketplace info is
 * persisted to disk — so that the on-disk state reflects the actual install
 * method. This keeps subsequent `updateMarketplace`, autoUpdate and startup
 * load paths on the Zip code path without requiring any per-path patches.
 *
 * See `apps/workbuddy-desktop/docs/refactor/marketplace/09-git-to-zip-fallback-design.md`
 * for the full design.
 */
export declare class GitFallbackCoordinator {
    protected readonly logger: Logger;
    protected readonly detector: GitAvailabilityDetector;
    protected readonly converter: GitToZipUrlConverter;
    /**
     * When the input is a Git/Github source and the local git is unavailable,
     * return a new Zip source targeting the platform's archive URL. Otherwise
     * return the input unchanged.
     *
     * Warnings are emitted (but no error is thrown) when git is unavailable
     * but no conversion is possible; the original source is returned so the
     * subsequent Git install can surface its native error message to the user.
     *
     * @param src Source produced by {@link PluginManagerImpl.parseSource}.
     * @param displayName Optional marketplace name used only for logging.
     */
    maybeFallback(src: MarketplaceSource, displayName?: string): Promise<MarketplaceSource>;
    /**
     * Extract a usable reference string from a Git/Github source. Prefers
     * the most explicit form (`url`) and falls back through `path` and
     * `repo` shorthand.
     */
    private extractUrl;
}
//# sourceMappingURL=git-fallback-coordinator.d.ts.map