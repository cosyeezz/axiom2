import { openCliCommand, selectSearchProfile, type OpenCliCommand } from "./opencli-command.js";
import { SearchInstallationCache } from "./search-installation.js";
import { SearchError } from "./search-errors.js";

interface RunCommand {
  requested?: string;
  contextId?: string;
  generation?: number;
  command?: OpenCliCommand;
  released?: boolean;
}

/** Installation validation is instance-scoped; browser identity is always run-scoped. */
export class SearchCommandCache {
  private runs = new Map<string, RunCommand>();
  private closed = false;
  constructor(private installation: Pick<SearchInstallationCache, "get" | "clear">, private execute = openCliCommand) {}
  async get(ownerKey: string, signal: AbortSignal): Promise<OpenCliCommand> {
    if (this.closed || signal.aborted) throw new SearchError("CANCELLED", "Search cancelled.");
    let installed: ReturnType<SearchInstallationCache["get"]>;
    try { installed = this.installation.get(); }
    catch (error) {
      for (const run of this.runs.values()) run.command = undefined;
      throw error;
    }
    const { invocation, generation } = installed;
    let run = ownerKey ? this.runs.get(ownerKey) : undefined;
    if (!run) {
      if (ownerKey && this.runs.size >= 128) throw new SearchError("BUDGET_EXCEEDED", "Too many active search runs.");
      run = { requested: invocation.env.OPENCLI_PROFILE };
      if (ownerKey) this.runs.set(ownerKey, run);
    }
    if (run.requested !== invocation.env.OPENCLI_PROFILE)
      throw new SearchError("PROFILE_CHANGED", "The configured Chrome profile changed during this run. Start a new run to use the new selection.", true);
    if (run.command && run.generation === generation) return run.command;
    run.command = undefined;
    const profiles = await this.execute(invocation, ["profile", "list"], signal);
    if (this.closed || run.released || signal.aborted) throw new SearchError("CANCELLED", "Search run ended during profile selection.");
    // Config/installation can change while the subprocess is running. Never issue
    // a navigation based on obsolete enablement or a newly selected identity.
    if (this.installation.get().generation !== generation)
      throw new SearchError("OPENCLI_CHANGED", "OpenCLI changed during profile selection. Retry after checking its configuration.", true);
    // Aliases are only valid for the initial selection, never for a pinned ID.
    run.contextId = run.contextId
      ? selectSearchProfile(profiles, run.contextId, true)
      : selectSearchProfile(profiles, run.requested);
    run.generation = generation;
    const pinned = run.contextId, record = run;
    const command: OpenCliCommand = async (args, commandSignal) => {
      // Already-owned tabs still need their original context for bounded cleanup.
      const cleanup = args[0] === "browser" && args[1] === "close";
      if (!cleanup && (this.closed || record.released)) throw new SearchError("CANCELLED", "Search run has ended.");
      try { return await this.execute(invocation, ["--profile", pinned, ...args], commandSignal); }
      catch (error) {
        // No automatic retry: a failed CLI may already have dispatched navigation.
        // Keep the contextId even after failures; revalidation must not change users.
        record.command = undefined;
        this.installation.clear();
        throw error;
      }
    };
    run.command = command;
    return command;
  }
  releaseRun(ownerKey: string) {
    const run = this.runs.get(ownerKey);
    if (run) run.released = true;
    this.runs.delete(ownerKey);
  }
  close() {
    this.closed = true;
    for (const run of this.runs.values()) run.released = true;
    this.runs.clear(); this.installation.clear();
  }
}
