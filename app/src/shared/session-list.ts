import type { Session } from "./protocol.js";

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
export interface SessionListInvalidation {
  revision: number;
}
