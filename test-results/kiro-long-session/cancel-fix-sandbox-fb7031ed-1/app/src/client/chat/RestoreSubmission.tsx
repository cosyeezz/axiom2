import type { Scope } from "../../shared/protocol.js";
import { restoreFailedSubmission } from "./submission-feedback.js";

export function RestoreSubmission({ scope, id, nested = false }: { scope: Scope; id: string; nested?: boolean }) {
  return <button type="button" className="btn" onClick={() => {
    if (!restoreFailedSubmission(scope, id)) return;
    const input = document.getElementById(nested ? `prompt-${scope.sessionId}` : "prompt") as HTMLTextAreaElement | null;
    input?.focus();
    input?.setSelectionRange(0, 0);
  }}>恢复编辑</button>;
}
