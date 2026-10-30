import type { Session } from "./protocol.js";

export const sessionListScope = "session-list";
export type SessionListGroup = "top" | "workspace";
export interface SessionListCursor {
  version: 1;
  streamId: string;
  revision: number;
  workspaceId: string;
  query: string;
  group: SessionListGroup;
  familyRank: number;
  memberRank: number;
}
export interface SessionListItem extends Session {
  /** Query-specific family metadata: never infer a missing parent from one page. */
  familyId: string;
  familyTop: boolean;
}
export interface SessionListPage {
  items: SessionListItem[];
  next: SessionListCursor | null;
  revision: number;
}
export interface SessionListInitial {
  top: SessionListPage;
  workspace: SessionListPage;
  revision: number;
}
export interface SessionListInvalidation {
  revision: number;
}
/** Target one workspace; a request contains 1–30 unique session IDs. */
export interface SessionListCountsParams {
  sessionIds: string[];
}
export interface SessionListCount {
  sessionId: string;
  /** Missing means unavailable, not an empty conversation. */
  messageCount?: number;
}
export interface SessionListCounts {
  workspaceId: string;
  items: SessionListCount[];
}
