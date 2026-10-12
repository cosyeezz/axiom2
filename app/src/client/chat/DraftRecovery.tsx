import { useState } from "react";
import { command } from "../transport.js";
import { useDraft, updateDraft } from "../drafts.js";
import type { Draft, Scope } from "../../shared/protocol.js";
export function DraftRecovery({ scope }: { scope: Scope }) {
  const current = useDraft(scope),
    [rows, setRows] = useState<(Draft & { viewId: string })[] | null>(null),
    [error, setError] = useState("");
  return (
    <details className="draft-recovery">
      <summary>恢复服务端草稿</summary>
      <p className="meta">
        显式选取此会话的已保存副本；不会自动覆盖其他窗口输入。
      </p>
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            setRows(await command("draft.list", {}, scope));
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        读取草稿副本
      </button>
      {rows
        ?.filter((r) => r.text || r.attachment)
        .map((row) => (
          <div key={row.viewId}>
            <p>
              {row.text.slice(0, 150)}
              {row.attachment && ` · ${row.attachment.name}`}
            </p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (
                  (current.text || current.attachment) &&
                  !confirm("用此副本替换本窗口当前草稿？不会发送消息。")
                )
                  return;
                updateDraft(scope, {
                  text: row.text,
                  attachment: row.attachment,
                });
                setRows(null);
              }}
            >
              恢复此草稿
            </button>
          </div>
        ))}
      {rows?.every((r) => !r.text && !r.attachment) && (
        <p>没有非空草稿副本。</p>
      )}
      <p role="status">{error}</p>
    </details>
  );
}
