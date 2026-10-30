import type { Scope } from "../../shared/protocol.js";
import { restoreFailedSubmission, restoreUncertainSubmission } from "./submission-feedback.js";

export function RestoreSubmission({ scope, id, nested = false, uncertain = false }: { scope: Scope; id: string; nested?: boolean; uncertain?: boolean }) {
  const restore = () => {
    if (!(uncertain ? restoreUncertainSubmission : restoreFailedSubmission)(scope, id)) return;
    // Focus the owning composer after the recovered row has unmounted.
    requestAnimationFrame(() => {
      const input = document.getElementById(nested ? `prompt-${scope.sessionId}` : "prompt") as HTMLTextAreaElement | null;
      input?.focus();
      input?.setSelectionRange(0, 0);
    });
  };
  return <button type="button" className="btn" onClick={restore}>恢复编辑</button>;
}
