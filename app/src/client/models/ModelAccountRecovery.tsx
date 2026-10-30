import { useEffect, useState } from "react";
import { command, useConnectionState, useScope } from "../transport.js";
import type { ModelAccounts } from "../../shared/model-accounts.js";

/** A failed first login may have saved credentials without authorizing activation. */
export function ModelAccountRecovery({ providerId, blocked, activated }: { providerId: string; blocked: boolean; activated: () => Promise<unknown> }) {
  const connection = useConnectionState(), invalidation = useScope("model-accounts", { revision: 0 });
  const [accounts, setAccounts] = useState<ModelAccounts>(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    if (connection.connected) void command<ModelAccounts>("accounts.list").then(value => {
      if (current) { setAccounts(value); setError(""); }
    }).catch(() => { if (current) setError("无法读取保留的账号，请重新读取配置后再试。"); });
    return () => { current = false; };
  }, [connection.connected, connection.generation, invalidation.revision, providerId]);
  const rows = accounts?.accounts.filter(row => row.providerId === providerId) ?? [];
  const pending = rows.length === 1 && !rows[0].active && !rows[0].legacy && rows[0].type ? rows[0] : undefined;
  if (!pending && !error) return null;
  return <section className="account-recovery" aria-label="启用已保留账号">
    {pending && <><p className="field-help">上次登录未正常结束，已保留账号「{pending.label}」，尚未启用。无需重复添加；确认后用于此供应商的新任务。</p>
      <button type="button" className="btn" disabled={busy || blocked || !connection.connected} onClick={async () => {
        setBusy(true); setError("");
        try {
          await command("accounts.activate", { accountId: pending.id, revision: accounts!.revision });
          await activated();
          setAccounts(await command<ModelAccounts>("accounts.list"));
        } catch (cause) { setError((cause as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "正在启用…" : "启用已保留账号"}</button></>}
    {error && <p role="alert" className="auth-error">{error}</p>}
  </section>;
}
