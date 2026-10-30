import { readFileSync } from "node:fs";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSession, SettingsManager } from "@earendil-works/pi-coding-agent";
import { sessionRetryDelaysMs } from "../shared/retry-policy.js";

type RetryPolicy = ReturnType<SettingsManager["getRetrySettings"]> & { delaysMs?: number[] };
const sdkEntry = import.meta.resolve("@earendil-works/pi-coding-agent");
const sdkVersion = JSON.parse(readFileSync(new URL("../package.json", sdkEntry), "utf8")).version;
const installed = new WeakSet<AgentSession>();
const nativeReaders = new WeakMap<SettingsManager, () => RetryPolicy>();

/** Session retry defaults only. Keep explicit Pi settings, including disabling retries,
 * and leave provider/summary retry policies untouched. Read afresh after reloads. */
export function sessionRetrySettings(settings: SettingsManager): RetryPolicy {
  const resolved = nativeReaders.get(settings)?.() ?? settings.getRetrySettings();
  const configured = settings.getSettings().retry ?? {};
  const customTiming = configured.baseDelayMs !== undefined || configured.maxAgentDelayMs !== undefined;
  return {
    ...resolved,
    maxRetries: configured.maxRetries ?? sessionRetryDelaysMs.length,
    maxAgentDelayMs: customTiming ? resolved.maxAgentDelayMs : sessionRetryDelaysMs.at(-1)!,
    ...(!customTiming ? { delaysMs: [...sessionRetryDelaysMs] } : {}),
  };
}

type RetrySessionBridge = {
  _prepareRetry(message: AssistantMessage): Promise<boolean>;
  _willRetryAfterAgentEnd(event: unknown): boolean;
};

/** Pi 1.4.0 has no custom-delay hook. Both native methods synchronously snapshot
 * getRetrySettings before returning (before the first await in _prepareRetry).
 * Substitute just that snapshot, NOT the async operation or retry loop. Pi still
 * owns classification, attempt accounting, context edits, events, sleep and abort.
 * Other settings consumers, especially compaction/branch summaries with their own
 * retry counters, must never see this per-session-attempt timing.
 */
export function installSessionRetryPolicy(session: AgentSession): void {
  if (installed.has(session)) return;
  const bridge = session as unknown as RetrySessionBridge;
  if (sdkVersion !== "1.4.0" || typeof bridge._prepareRetry !== "function" || typeof bridge._willRetryAfterAgentEnd !== "function")
    throw Error("Pi 会话重试接口不兼容，请核对九档重试策略后再升级。");
  const prepare = bridge._prepareRetry, willRetry = bridge._willRetryAfterAgentEnd;
  const settings = session.settingsManager;
  const withPolicy = <T>(policy: RetryPolicy, run: () => T): T => {
    const original = settings.getRetrySettings, previousReader = nativeReaders.get(settings);
    nativeReaders.set(settings, previousReader ?? original.bind(settings));
    settings.getRetrySettings = () => policy;
    try { return run(); } finally {
      settings.getRetrySettings = original;
      if (previousReader) nativeReaders.set(settings, previousReader); else nativeReaders.delete(settings);
    }
  };
  bridge._willRetryAfterAgentEnd = event =>
    withPolicy(sessionRetrySettings(settings), () => willRetry.call(session, event));
  bridge._prepareRetry = message => {
    const policy = sessionRetrySettings(settings);
    const delay = policy.delaysMs?.[Math.min(session.retryAttempt, policy.delaysMs.length - 1)];
    // Native min(base * 2^(attempt-1), cap) equals the desired delay when base=cap.
    // No extra timer or outer retry loop; long waits remain natively cancellable.
    return withPolicy(delay === undefined ? policy : { ...policy, baseDelayMs: delay, maxAgentDelayMs: delay },
      () => prepare.call(session, message));
  };
  installed.add(session);
}
