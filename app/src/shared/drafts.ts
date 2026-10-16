import type { Draft } from "./protocol.js";

export interface DraftStamp {
  revision: number;
  writer: string;
  sequence: number;
}
export interface DraftRecord extends DraftStamp {
  draft: Draft;
  submissionId?: string;
  submissionStatus?: string;
}
export interface DraftWrite extends DraftRecord {}
