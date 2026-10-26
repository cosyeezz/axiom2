import { createContext, useContext, useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import { agentScope, emptyAgent, running } from "../../shared/agent.js";
import { taskActive } from "../../shared/tasks.js";
import { Icon } from "../Icon.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { useConnectionState, useScope } from "../transport.js";

export const ForkConversation = createContext<{
  busy: boolean;
  fork: (scope: Scope, params: Record<string, unknown>, requestId: string, openAfterCreate: boolean) => Promise<void>;
} | null>(null);

export function ForkButton({ scope, messageId, disabled = false }: {
  scope: Scope; messageId: string; disabled?: boolean;
}) {
  const action = useContext(ForkConversation);
  const [requestId, setRequestId] = useState<string | null>(null);
  const info = useScope(agentScope(scope), emptyAgent);
  const connected = useConnectionState().connected;
  if (!action) return null;
  const active = running(info.run) || !!info.activeTaskCount || !!info.queue?.length || !!info.task && taskActive(info.task.status);
  return <><button type="button" className="action-icon fork-action"
    aria-label="从此处创建分支" aria-busy={action.busy}
    data-tooltip={action.busy ? "正在创建分支…" : active ? "执行结束或停止后可创建分支" : "从此处创建分支（Fork）"}
    disabled={disabled || action.busy || !connected || active}
    onClick={() => setRequestId(crypto.randomUUID())}>
    <Icon name="git-branch" />
  </button>{requestId && <ConfirmDialog title="创建分支会话" confirmLabel="创建并打开"
    description="从此处创建新分支，显示在原会话标题下方。可创建并打开，或仅创建并留在当前会话。"
    secondaryAction={{ label: "仅创建", onConfirm: () => action.fork(scope, { messageId }, requestId, false) }}
    onClose={() => setRequestId(null)} onConfirm={() => action.fork(scope, { messageId }, requestId, true)} />}</>;
}
