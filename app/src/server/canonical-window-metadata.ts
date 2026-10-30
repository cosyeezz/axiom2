import type { CanonicalSourceCapture } from "../shared/canonical-source-capture.js";
import type { WindowCollection, WindowCollectionMetadata, WindowMessageMetadata } from "../shared/thread-window.js";

type Message = NonNullable<ReturnType<CanonicalSourceCapture["message"]>>;

/** The caller supplies the same trusted immutable display capture as the body.
 * Pick schema fields explicitly: no arbitrary extras, IDs, body or nested arrays.
 * JSON encoding a requested individual record may still be O(record length).
 */
export function windowMessageMetadata(message: Message): WindowMessageMetadata {
  const compression = message.compression, failure = message.kiroFailure;
  return {
    compression: compression ? { number: compression.number, title: compression.title, before: compression.before, after: compression.after } : null,
    kiroFailure: failure ? { stage: failure.stage, category: failure.category, partial: failure.partial,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      ...(failure.code === undefined ? {} : { code: failure.code }),
      ...(failure.requestId === undefined ? {} : { requestId: failure.requestId }),
      ...(failure.observedValidationReason ? { observedValidationReason: { token: failure.observedValidationReason.token,
        contract: failure.observedValidationReason.contract, source: failure.observedValidationReason.source } } : {}) } : null,
  };
}
export function windowCollectionItems(message: Message, collection: WindowCollection) {
  return (collection === "inputs" ? message.inputIds : message[collection]) ?? [];
}
export function windowCollectionMetadata(message: Message, collection: WindowCollection, index: number): WindowCollectionMetadata | undefined {
  if (collection === "images") {
    const item = message.images?.[index];
    return item && { kind: "image", name: item.name, mimeType: item.mimeType, path: item.path ?? null };
  }
  if (collection === "attachments") {
    const item = message.attachments?.[index];
    return item && { kind: "attachment", name: item.name, attachmentKind: item.kind ?? null, path: item.path ?? null };
  }
  if (collection === "skills") {
    const item = message.skills?.[index];
    return item && { kind: "skill", name: item.name, description: item.description };
  }
  // Inputs expose equality refs, not their private receipt IDs as a text channel.
  return undefined;
}
