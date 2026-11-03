import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { webSearchLimits as limits } from "../../shared/web-search.js";
import { googleSearchOrigins, googleSerpExpression, type SerpPage } from "./google-serp.js";
import { type OpenCliCommand } from "./opencli-command.js";
import { SearchInstallationCache } from "./search-installation.js";
import { SearchCommandCache } from "./search-command-cache.js";
import { SearchError } from "./search-errors.js";
import { type SearchWindow } from "./search-window.js";

export interface SearchPage { items: SerpPage["items"]; nextStart?: number; warning?: string }
export interface SearchBackend {
  search(query: string, start: number, limit: number, signal: AbortSignal, progress: (text: string) => void, ownerKey?: string): Promise<SearchPage>;
  releaseRun?(ownerKey: string): void;
  close(): void;
}
interface QuerySession { id: string; query: string; start: number; limit: number; command: OpenCliCommand; human: boolean; uncertain?: boolean; ownerKey: string; released?: boolean }

/** One-query script: every browser action actually invokes OpenCLI; no independent browser transport. */
export class OpenCliSearchBackend implements SearchBackend {
  private shutdown = new AbortController();
  private active = false;
  private activeRun?: { ownerKey: string; abort: AbortController };
  private anonymousOwnerKey = `anonymous-search-${randomUUID()}`;
  private retained?: QuerySession;
  private commands: SearchCommandCache;
  private commandFactory: (signal: AbortSignal, ownerKey: string) => OpenCliCommand | Promise<OpenCliCommand>;
  constructor(root: string, commandFactory?: (signal: AbortSignal, ownerKey: string) => OpenCliCommand | Promise<OpenCliCommand>,
    private window?: SearchWindow) {
    this.commands = new SearchCommandCache(new SearchInstallationCache(root));
    this.commandFactory = commandFactory ?? ((signal, ownerKey) => this.commands.get(ownerKey, signal));
  }
  async search(query: string, start: number, limit: number, external: AbortSignal, progress: (text: string) => void, ownerKey = ""): Promise<SearchPage> {
    const runAbort = new AbortController();
    const signal = AbortSignal.any([external, this.shutdown.signal, runAbort.signal, AbortSignal.timeout(limits.timeoutMs)]);
    if (signal.aborted) throw new SearchError("CANCELLED", "Search cancelled.");
    if (this.active) throw new SearchError("BUSY", "OpenCLI search is busy.", true);
    this.active = true;
    this.activeRun = { ownerKey, abort: runAbort };
    let session: QuerySession | undefined;
    try {
      if (this.retained?.uncertain) throw new SearchError("CLEANUP_PENDING", "An interrupted OpenCLI navigation has an unknown browser outcome. Inspect and close the search tab, then restart the search service before retrying.");
      if (this.retained && !this.retained.human) await this.cleanup(this.retained);
      session = this.retained;
      if (session && (session.ownerKey !== ownerKey || session.query !== query || session.start !== start || session.limit !== limit))
        throw new SearchError("VERIFICATION_PENDING", "Complete verification in the retained Chrome search tab, then retry the same query and pagination parameters.", true);
      const resume = Boolean(session);
      // Recheck enablement/file identity even when resuming a retained human tab.
      // The cache pins the original contextId throughout this run.
      const selectedCommand = await this.commandFactory(signal, ownerKey || this.anonymousOwnerKey);
      session ??= { id: `axiom-search-${randomUUID()}`, query, start, limit, command: selectedCommand, human: false, ownerKey };
      session.command = selectedCommand;
      this.retained = session; // Own the session before any possibly interrupted browser command.
      const command = (args: string[], foreground = false) => session!.command([
        "browser", ...args, "--session", session!.id, "--window", foreground ? "foreground" : "background",
      ], signal);
      if (!resume) {
        const url = new URL("https://www.google.com/search");
        url.search = new URLSearchParams({ q: query, hl: "en", num: String(limit), start: String(start) }).toString();
        try { await command(["open", url.href]); }
        catch (error) {
          // CLI termination/transport errors do not cancel commands already dispatched by the shared daemon.
          // Even a subsequent close acknowledgement cannot rule out late tab creation.
          session.uncertain = true;
          throw new SearchError("OPENCLI_OUTCOME_UNKNOWN", "OpenCLI navigation was interrupted or failed without a confirmed browser outcome. Search-tab cleanup was requested, but late navigation cannot be ruled out; inspect the tab before restarting the search service.");
        }
        await this.arrange(session, "hide", signal);
      } else if (session.human) await this.arrange(session, "show", signal);
      const expression = `JSON.stringify({url:location.href,page:${googleSerpExpression}})`;
      const began = Date.now();
      let verificationAt = session.human ? began : 0;
      for (;;) {
        if (signal.aborted) throw new SearchError("CANCELLED", "Search cancelled or timed out.");
        let data: any = await command(["eval", expression], session.human);
        if (signal.aborted) throw new SearchError("CANCELLED", "Search run ended during page observation.");
        try { if (typeof data === "string") data = JSON.parse(data); }
        catch { throw new SearchError("INVALID_RESPONSE", "OpenCLI returned invalid search evidence."); }
        const page = data?.page as SerpPage | undefined;
        if (!page || !Array.isArray(page.items) || page.items.length > 100) throw new SearchError("INVALID_RESPONSE", "OpenCLI returned invalid search evidence.");
        if (page.kind === "captcha" || page.kind === "consent") {
          if (!verificationAt) {
            verificationAt = Date.now(); session.human = true;
            progress("Google requires verification or consent. Complete it yourself in the OpenCLI Chrome search tab; this tool will only observe the same page and will not solve or accept it.");
            await this.arrange(session, "show", signal);
          }
          if (Date.now() - verificationAt >= limits.verificationMs)
            throw new SearchError("HUMAN_VERIFICATION_REQUIRED", "Complete verification in the retained Chrome search tab, then retry the same query and pagination parameters.", true);
        } else {
          let url: URL;
          try { url = new URL(data.url); } catch { throw new SearchError("INVALID_RESPONSE", "Missing Google search page identity."); }
          if (!googleSearchOrigins.has(url.origin) || url.pathname !== "/search" || url.searchParams.get("q") !== query || Number(url.searchParams.get("start") || 0) !== start)
            throw new SearchError("PAGE_CHANGED", "The Chrome page no longer matches the requested Google query and offset.", true);
          if (page.kind === "results" || page.kind === "empty") {
            if (session.human) await this.arrange(session, "hide", signal);
            session.human = false;
            const result: SearchPage = { items: page.items.slice(0, limit), nextStart: page.nextStart };
            return result;
          }
          if (Date.now() - began >= 8000 && !verificationAt)
            throw new SearchError("SERP_UNRECOGNIZED", "Google did not expose recognized results or an explicit empty-result page.", true);
          if (verificationAt && Date.now() - verificationAt >= limits.verificationMs)
            throw new SearchError("HUMAN_VERIFICATION_REQUIRED", "The verification page has not returned to recognized Google results. Complete it and retry the same query.", true);
        }
        await delay(1500, undefined, { signal }).catch(() => { throw new SearchError("CANCELLED", "Search cancelled or timed out."); });
      }
    } finally {
      try {
        // Keep a handed-off tab intact on cancellation/timeout. A same-query retry observes it without navigating.
        if (session && !session.human && this.retained === session) await this.cleanup(session);
        if (session?.human && session.released && this.retained === session) this.retained = undefined;
      } finally {
        // Anonymous direct callers share identity only while their human tab is retained.
        if (!ownerKey && !this.retained?.human) this.commands.releaseRun(this.anonymousOwnerKey);
        this.activeRun = undefined; this.active = false;
      }
    }
  }
  /** Window placement is best effort; it never changes search results or errors. */
  private async arrange(session: QuerySession, mode: "hide" | "show", signal: AbortSignal) {
    if (!this.window || signal.aborted) return;
    try { await this.window[mode](session.command, signal); } catch {}
  }
  private async cleanup(session: QuerySession) {
    try {
      await session.command(["browser", "close", "--session", session.id, "--window", "background"], AbortSignal.timeout(10_000));
      if (this.retained === session && !session.uncertain) this.retained = undefined;
    } catch {
      throw new SearchError("CLEANUP_PENDING", "OpenCLI did not confirm search-tab cleanup. Check the Chrome connection and retry; no user window or shared daemon was stopped.", true);
    }
  }
  releaseRun(ownerKey: string) {
    this.commands.releaseRun(ownerKey || this.anonymousOwnerKey);
    if (this.activeRun?.ownerKey === ownerKey) this.activeRun.abort.abort();
    const session = this.retained;
    if (!session || session.ownerKey !== ownerKey) return;
    session.released = true;
    // A handed-off tab belongs to the user after its run ends; never let another run resume it.
    if (session.human) this.retained = undefined;
  }
  close() { this.shutdown.abort(); this.commands.close(); }
}
