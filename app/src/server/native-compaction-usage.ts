import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";
import { nativeCompactionAttemptKind, sumCosts } from "../shared/costs.js";
import { usageCost } from "./usage-cost.js";

const installed = new WeakSet<AgentSession>();
const tokens = ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const;
const parts = ["input", "output", "cacheRead", "cacheWrite", "total"] as const;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
/** SDK-compatible zero counters, but explicitly NOT a measured free request. */
function unknownUsage(): Usage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, axiomUsageUnknown: true } as Usage;
}

/** Validate checkpoint attribution and price each request separately: combining
 * two sub-200k Gemini requests before pricing would incorrectly select a tier. */
export function nativeCompactionCost(value: unknown, details: unknown) {
  const fallback = { totals: usageCost(value), provider: undefined as string | undefined, model: undefined as string | undefined };
  const metadata = (details as { axiomNativeCompaction?: { version?: unknown; calls?: unknown } } | null)?.axiomNativeCompaction;
  const usage = value as Usage | undefined;
  if (fallback.totals.unknownTokens || metadata?.version !== 1 || !Array.isArray(metadata.calls) || metadata.calls.length < 1 || metadata.calls.length > 2) return fallback;
  const calls = metadata.calls as { provider: string; model: string; usage: Usage }[];
  if (!calls.every(call => call && [call.provider, call.model].every(id => typeof id === "string" && id.length > 0 && id.length <= 160)) ||
      !tokens.every(key => finite(usage?.[key]) && calls.every(call => finite(call.usage?.[key])) && usage![key] === calls.reduce((n, call) => n + call.usage[key], 0)) ||
      !parts.every(key => finite(usage?.cost?.[key]) && calls.every(call => finite(call.usage?.cost?.[key])) && usage!.cost[key] === calls.reduce((n, call) => n + call.usage.cost[key], 0))) return fallback;
  const sameModel = calls.every(call => call.provider === calls[0].provider && call.model === calls[0].model);
  return { totals: sumCosts(calls.map(call => usageCost(call.usage, call.model))),
    provider: sameModel ? calls[0].provider : undefined, model: sameModel ? calls[0].model : undefined };
}

/** Non-Kiro native compaction accounting. Kiro has its own measurement guard;
 * scratch workers already own a per-invocation ledger. Branch summaries and SDK
 * transport-internal retries do not emit these events and are not covered here.
 * The end-of-operation append is deliberately not claimed to be crash-atomic.
 */
export function installNativeCompactionUsage(session: AgentSession, options: { externalBilling?: boolean } = {}) {
  if (installed.has(session) || options.externalBilling) return;
  installed.add(session);
  type Attempt = { provider: string; model: string; usage: Usage; source?: Usage; accepted: boolean; covered: boolean };
  type Generation = { calls: Attempt[]; ambiguous: boolean; foreign: boolean; checkpoint: boolean };
  let active: Generation | undefined;
  const manager = session.sessionManager;
  session.subscribe(event => {
    if (event.type === "compaction_start") active = { calls: [], ambiguous: false, foreign: false, checkpoint: false };
    if (event.type !== "compaction_end") return;
    const generation = active; active = undefined;
    if (!generation?.calls.length) return;
    try {
      if (generation.ambiguous) {
        // An extension/mixed checkpoint may already own these charges. Do not
        // double-count guessed ownership; explicitly retain incomplete accounting.
        const call = generation.calls[0];
        manager.appendUsage(nativeCompactionAttemptKind, call.provider, call.model, unknownUsage(), "摘要账务归属无法核对，未重复累加可能已合并的费用");
        return;
      }
      for (const call of generation.calls) if (!call.covered)
        manager.appendUsage(nativeCompactionAttemptKind, call.provider, call.model, structuredClone(call.usage));
    } catch {
      // SDK event dispatch does not isolate subscribers. A failed accounting write
      // must not make an already committed checkpoint look like a failed operation.
      console.error("原生压缩用量记录写入失败；会话费用可能不完整。");
    }
  });
  const stream = session.agent.streamFunction;
  session.agent.streamFunction = (...args: Parameters<typeof stream>) => {
    const generation = active;
    if (!generation) return stream(...args);
    if (args[0].api === "kiro-chat") { generation.foreign = true; return stream(...args); }
    if (args[2]?.signal?.aborted) return stream(...args);
    const call: Attempt = { provider: args[0].provider, model: args[0].id, usage: unknownUsage(), accepted: false, covered: false };
    generation.calls.push(call);
    const response = stream(...args);
    const observe = (output: Awaited<ReturnType<typeof stream>>) => {
      const original = output.result.bind(output);
      let result: ReturnType<typeof original> | undefined;
      output.result = () => result ??= original().then(message => {
        if (active === generation) {
          call.provider = message.provider; call.model = message.responseModel ?? message.model;
          call.source = message.usage; call.usage = structuredClone(message.usage);
          call.accepted = message.stopReason === "stop";
        }
        return message;
      });
      return output;
    };
    return response instanceof Promise ? response.then(observe) : observe(response);
  };
  const append = manager.appendCompaction.bind(manager);
  manager.appendCompaction = (...args: Parameters<typeof append>) => {
    const generation = active, usage = args[5];
    const accepted = generation?.calls.filter(call => call.accepted && !call.covered) ?? [];
    const aliases = accepted.filter(call => call.source === usage);
    const adopted = aliases.length === 1 ? aliases : aliases.length === 0 && accepted.length === 2 ? accepted : [];
    const matches = !args[4] && usage && !generation?.foreign && !generation?.checkpoint && adopted.length > 0 &&
      tokens.every(key => finite(usage[key]) && adopted.every(call => finite(call.usage[key])) && usage[key] === adopted.reduce((n, call) => n + call.usage[key], 0)) &&
      parts.every(key => finite(usage.cost?.[key]) && adopted.every(call => finite(call.usage.cost?.[key])) && usage.cost[key] === adopted.reduce((n, call) => n + call.usage.cost[key], 0));
    // Preserve per-request attribution, not just one model for combined usage:
    // tiered public prices must be applied before combining split summaries.
    if (matches && adopted.length === accepted.length && (args[3] == null || typeof args[3] === "object" && !Array.isArray(args[3]))) {
      args[3] = { ...args[3] as Record<string, unknown>, axiomNativeCompaction: { version: 1,
        calls: adopted.map(call => ({ provider: call.provider, model: call.model, usage: structuredClone(call.usage) })) } };
    }
    const id = append(...args); // Only a successfully persisted checkpoint owns charges.
    if (generation && generation.calls.length) {
      generation.checkpoint = true;
      if (matches && adopted.length === accepted.length) for (const call of adopted) call.covered = true;
      else generation.ambiguous = true;
    }
    return id;
  };
}
