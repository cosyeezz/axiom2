import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import { hasKiroUsage, kiroCompactionAttemptKind, kiroUsageInfo } from "../shared/kiro-usage.js";
import { kiroRequestUsage, kiroSummarySucceeded, kiroSummaryUsage } from "./providers/kiro-usage.js";

type CompactionUsageGuard = { isCancelled(): boolean };
const installed = new WeakMap<AgentSession, CompactionUsageGuard>();
const counters = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;

/** Public instance APIs only. Successful summaries are billed once by their
 * checkpoint; other native attempts get context-invisible usage at compaction_end.
 * externalBilling leaves the scratch compression worker's existing IPC ledger sole
 * owner. End-of-operation accounting is not crash-atomic request persistence.
 */
export function installKiroCompactionUsage(session: AgentSession, options: { externalBilling?: boolean } = {}): CompactionUsageGuard {
  const existing = installed.get(session);
  if (existing) return existing;
  type Attempt = { provider: string; model: string; usage: Usage; sourceUsage?: Usage; accepted?: AssistantMessage; covered: boolean };
  type Generation = { calls: Attempt[]; target?: { provider: string; model: string }; eligible: boolean; custom: boolean; uncertainAppend: boolean; aborted: boolean };
  let active: Generation | undefined;
  const guard = { isCancelled: () => active?.aborted === true };
  installed.set(session, guard);
  const manager = session.sessionManager;
  session.subscribe(event => {
    if (event.type === "compaction_start") active = { calls: [], eligible: true, custom: false, uncertainAppend: false, aborted: false };
    if (event.type !== "compaction_end") return;
    const generation = active; active = undefined;
    if (options.externalBilling || !generation || generation.custom || generation.uncertainAppend) return;
    for (const call of generation.calls) if (!call.covered)
      manager.appendUsage(kiroCompactionAttemptKind, call.provider, call.model, structuredClone(call.usage));
  });
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (...args: Parameters<typeof stream>) => {
    const generation = active;
    if (!generation) return stream(...args);
    // Other providers keep their original stream and result identity/behaviour.
    if (args[0].api !== "kiro-chat") { generation.eligible = false; return stream(...args); }
    // Pi may continue from an aborted history response into its split prefix.
    // Do not create another native attempt or bill pre-dispatch cancellation.
    if (generation.aborted) throw Error("Kiro 摘要请求已取消，未继续请求摘要。");
    if (args[2]?.signal?.aborted) return stream(...args);
    if (generation.target && (generation.target.provider !== args[0].provider || generation.target.model !== args[0].id))
      generation.eligible = false;
    generation.target ??= { provider: args[0].provider, model: args[0].id };
    // An invocation that fails before a result is unknown, not a fabricated zero.
    const call: Attempt = { provider: args[0].provider, model: args[0].id,
      usage: kiroRequestUsage(args[0]).usage, covered: false };
    generation.calls.push(call);
    const response = stream(...args);
    const observe = (output: Awaited<ReturnType<typeof stream>>) => {
      const original = output.result.bind(output);
      let result: ReturnType<typeof original> | undefined;
      output.result = () => result ??= original().then(message => {
        // This chained result is what Pi awaits: observation precedes combine/append.
        if (active === generation) {
          const info = kiroUsageInfo(message.usage);
          call.provider = message.provider; call.model = message.responseModel ?? message.model;
          call.sourceUsage = message.usage;
          if (info?.scope !== "request" || message.api !== "kiro-chat" || message.provider !== args[0].provider || message.model !== args[0].id)
            generation.eligible = false;
          call.usage = info?.scope === "request" ? structuredClone(message.usage)
            : { ...message.usage, cost: { ...message.usage.cost }, axiomKiro: structuredClone((call.usage as typeof call.usage & { axiomKiro: unknown }).axiomKiro) } as Usage;
          generation.aborted ||= message.stopReason === "aborted";
          if (kiroSummarySucceeded(message)) call.accepted = {
            role: "assistant", api: message.api, provider: message.provider, model: message.model,
            timestamp: message.timestamp, stopReason: message.stopReason, content: [], usage: call.usage,
          }; // Retain counters/provenance only, never the potentially large summary text.
        }
        return message;
      });
      return output;
    };
    return response instanceof Promise ? response.then(observe) : observe(response);
  };
  const append = manager.appendCompaction.bind(manager);
  manager.appendCompaction = (...args: Parameters<typeof append>) => {
    const usage = args[5], generation = active;
    if (generation && args[4]) generation.custom = true;
    // Pi does not itself reject stopReason=aborted when a provider returned it
    // without aborting the session signal. Never checkpoint that incomplete result.
    if (generation?.aborted && !args[4]) throw Error("Kiro 摘要请求已取消，未应用压缩。");
    const accepted = generation?.calls.filter(call => call.accepted) ?? [];
    // Pi 1.1.0 preserves physical usage identity for one summary (including a
    // prefix-only split); only a two-summary split creates an unmarked combine.
    // Counter equality alone would incorrectly adopt incidental zero-count calls.
    const aliases = accepted.filter(call => call.sourceUsage === usage);
    const adopted = aliases.length === 1 ? aliases : aliases.length === 0 && accepted.length === 2 && !hasKiroUsage(usage) ? accepted : [];
    const matches = !args[4] && usage && generation?.eligible && adopted.length &&
      counters.every(key => usage[key] === adopted.reduce((sum, call) => sum + call.usage[key], 0));
    if (matches) {
      // A single summary can alias its physical message: enrich a COPY. Never
      // change a request marker to summary or reprice combined tokens at one tier.
      args[5] = kiroSummaryUsage(usage, adopted.map(call => call.accepted!));
    }
    const id = append(...args);
    if (generation && !args[4]) {
      if (matches) {
        for (const call of adopted) call.covered = true;
        if (adopted.length !== accepted.length) generation.uncertainAppend = true;
      } else generation.uncertainAppend = true; // Cannot guess a mixed/custom aggregate's billing ownership.
    }
    return id;
  };
  return guard;
}
