import type { Draft } from "./protocol.js";

/** Bound to one persisted branch, not merely the text currently displayed. */
export interface RewriteTarget {
  messageId: string;
  revision: string;
}
export interface EditableMessage extends RewriteTarget {
  draft: Draft;
}
