import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { RunOrigin } from "../shared/agent.js";
import { captureCanonicalSources, type CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import { threadGroups } from "../shared/thread-layout.js";
import { historyProjection } from "./history-projection.js";
import { transcriptMessages } from "./transcript.js";

/**
 * Native-only coordination of a trusted, fixed, exclusively held parsed manager.
 * Does not establish filesystem, scope, cache or pending-overlay authority.
 * Full native projection/grouping, hashing and capture-copying costs remain.
 */
export function captureNativeCanonicalSources(input: {
  readonly manager: SessionManager;
  readonly origins?: ReadonlyMap<string, RunOrigin>;
}): CanonicalSourceCapture {
  const manager = input.manager;
  const origins = new Map<string, RunOrigin>(input.origins);
  const archive = historyProjection(manager, "canonical-native", origins);
  const current = transcriptMessages(manager);
  for (const message of current) {
    const origin = message.runId && origins.get(message.runId);
    if (origin) message.runOrigin = origin;
  }
  const currentMessages = new Map(current.map(message => [message.id, message]));
  return captureCanonicalSources({ archive, currentGroups: threadGroups(current), currentMessages,
    transientMessages: new Map() });
}
