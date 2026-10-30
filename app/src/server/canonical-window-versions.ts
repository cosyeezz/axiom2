import type { CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import type { WindowCallDescriptor, WindowCollection, WindowMessageDescriptor, WindowSegmentPage } from "../shared/thread-window.js";
import type { createWindowIdentity } from "./canonical-window-identity.js";
import { windowCollectionItems, windowCollectionMetadata } from "./canonical-window-metadata.js";

type Identity = ReturnType<typeof createWindowIdentity>;
type Message = NonNullable<ReturnType<CanonicalSourceCapture["message"]>>;
/** Caller constructs these bounded DTOs explicitly. Snapshot refs are NOT content
 * facts. Equality covers only the descriptor, never the unpreviewed full fields. */
export function windowMessageVersion(item: Omit<WindowMessageDescriptor, "descriptorVersion">, identity: Identity) {
  const { revision: _revision, entityRef: _ref, ...facts } = item;
  return identity.version("message-descriptor-v1", [JSON.stringify(facts)]);
}
export function windowCallVersion(item: Omit<WindowCallDescriptor, "descriptorVersion">, identity: Identity) {
  const { ref: _ref, result, ...facts } = item;
  const resultFacts = result ? (({ ref: _resultRef, ...values }: NonNullable<WindowCallDescriptor["result"]>) => values)(result) : null;
  return identity.version("call-descriptor-v1", [JSON.stringify({ ...facts, result: resultFacts })]);
}
export function windowSegmentVersion(item: Omit<WindowSegmentPage["items"][number], "descriptorVersion">, identity: Identity) {
  const { ref: _ref, ...facts } = item;
  return identity.version("segment-descriptor-v1", [JSON.stringify(facts)]);
}
/** Full ordered allowed collection, not a version of just the requested page.
 * IDs stay private but identity replacement invalidates pagination even if labels
 * match. Ignores arbitrary extras and image bytes. O(collection metadata bytes),
 * once per requested cut/member/collection, not a CPU/RSS bound. */
export function windowCollectionVersion(message: Message, collection: WindowCollection, hasBody: boolean, identity: Identity) {
  function* facts(): Generator<string> {
    const items = hasBody ? windowCollectionItems(message, collection) : [];
    yield collection; yield String(items.length);
    for (const [index, item] of items.entries())
      yield JSON.stringify(typeof item === "string" ? [item] : [item.id ?? null, windowCollectionMetadata(message, collection, index)]);
  }
  return identity.version("collection-v1", facts());
}
