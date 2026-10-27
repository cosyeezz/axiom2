import { useState } from "react";
import type { Scope } from "../../shared/protocol.js";
import { ConfirmDialog } from "../ConfirmDialog.js";
import { restoreFailedSubmission, restoreUncertainSubmission } from "./submission-feedback.js";

export function RestoreSubmission({ scope, id, nested = false, uncertain = false }: { scope: Scope; id: string; nested?: boolean; uncertain?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const restore = () => {
    if (!(uncertain ? restoreUncertainSubmission : restoreFailedSubmission)(scope, id)) return;
    // The queue row unmounts after recovery. Focus only once the confirmation
    // dialog has also closed, so its native focus restoration cannot steal it.
    requestAnimationFrame(() => {
      const input = document.getElementById(nested ? `prompt-${scope.sessionId}` : "prompt") as HTMLTextAreaElement | null;
      input?.focus();
      input?.setSelectionRange(0, 0);
    });
  };
  return <><button type="button" className="btn" onClick={() => uncertain ? setConfirming(true) : restore()}>恢复编辑</button>
    {confirming && <ConfirmDialog title="恢复未确认的消息？"
      description="将原文、附件和技能引用恢复到输入框，并保留当前草稿。此操作只恢复编辑，不会发送消息，也不会撤回此前的请求。"
      warning="此前的消息可能已经被接收或执行。请先核对会话记录；再次发送可能造成重复执行。"
      confirmLabel="确认恢复编辑" onConfirm={restore} onClose={() => setConfirming(false)} />}
  </>;
}
