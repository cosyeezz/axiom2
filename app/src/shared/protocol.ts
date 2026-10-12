export interface Workspace {
  id: string;
  name: string;
  path: string;
  authorized: boolean;
}
export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  pinned: boolean;
  unread: boolean;
  updatedAt: number;
  runStatus?: import("./agent.js").Run["status"];
  activeTasks?: boolean;
}
export interface Scope {
  workspaceId: string;
  sessionId: string;
}
export interface Attachment {
  name: string;
  text: string;
}
export interface Draft {
  text: string;
  attachment: Attachment | null;
  revision: number;
}
export interface ModelSummary {
  provider: string;
  id: string;
  name: string;
  levels: import("./agent.js").Thinking[];
}
export interface Configuration {
  revision: string;
  providerCount: number;
  modelCount: number;
  available: ModelSummary[];
  dataRoot: string;
  error?: string;
}
export type Command = {
  requestId: string;
  op: string;
  workspaceId?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
};
export type Reply =
  | { type: "receipt"; requestId: string; ok: true; data: unknown }
  | {
      type: "receipt";
      requestId: string;
      ok: false;
      error: { code: string; message: string };
    };
export interface Snapshot {
  type: "snapshot";
  scope: string;
  streamId: string;
  seq: number;
  data: unknown;
}
export const scopeKey = ({ workspaceId, sessionId }: Scope) =>
  `session:${workspaceId}:${sessionId}`;
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function text(value: unknown, name: string, max = 200): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw new AppError("INVALID_INPUT", `${name} 无效（1–${max} 字符）`);
  return value.trim();
}
export function attachmentInput(value: unknown): Attachment | null {
  if (value == null) return null;
  const a = object(value),
    name = text(a.name, "附件名称", 255);
  if (
    !/\.(txt|md|js|jsx|ts|tsx|json|py|css|html)$/i.test(name) ||
    typeof a.text !== "string" ||
    new TextEncoder().encode(a.text).byteLength > 100000 ||
    a.text.includes("\0")
  )
    throw new AppError(
      "INVALID_ATTACHMENT",
      "仅支持小于 100 KB 的文本或代码文件",
    );
  return { name, text: a.text };
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("INVALID_INPUT", "参数必须为对象");
  return value as Record<string, unknown>;
}
