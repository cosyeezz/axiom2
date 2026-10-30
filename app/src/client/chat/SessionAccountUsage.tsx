import { useEffect, useState } from "react";
import { agentScope, emptyAgent } from "../../shared/agent.js";
import type { Scope } from "../../shared/protocol.js";
import { hasQuotaRecord, type SessionAccountUsage as Snapshot } from "../../shared/session-account-usage.js";
import { command, useConnectionState, useScope } from "../transport.js";
import { Icon } from "../Icon.js";
import { ProviderUsage } from "../models/ProviderUsage.js";
import { MetricDetail } from "./MetricDetail.js";
import "../styles/session-account-usage.css";

const emptyRevision = { revision: 0 };
/** This shortcut reads already verified local records only. Mounting or opening it never queries a provider. */
export function SessionAccountUsage({ scope }: { scope?: Scope }) {
  const info = useScope(scope ? agentScope(scope) : null, emptyAgent);
  const accounts = useScope("model-accounts", emptyRevision), connection = useConnectionState();
  const selection = info.selection;
  const key = JSON.stringify([scope?.workspaceId, scope?.sessionId, selection?.provider, selection?.id, info.run?.id, info.run?.status, accounts.revision, connection.generation]);
  const [snapshot, setSnapshot] = useState<{ key: string; value: Snapshot | null }>();
  const [opened, setOpened] = useState<{ identity: string; trigger: HTMLButtonElement }>();
  useEffect(() => {
    setSnapshot(undefined); setOpened(undefined);
    if (!scope || !connection.connected || !selection?.provider) return;
    let disposed = false, pending = false;
    const controller = new AbortController();
    const read = async () => {
      if (disposed || pending || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const value = await command<Snapshot | null>("agent.accountUsage.cached", {}, scope, crypto.randomUUID(), controller.signal);
        if (!disposed) setSnapshot({ key, value: value?.providerId === selection.provider && hasQuotaRecord(value.usage) ? value : null });
      } catch { if (!disposed) setSnapshot({ key, value: null }); }
      finally { pending = false; }
    };
    void read();
    const timer = setInterval(() => { void read(); }, 5_000);
    const visible = () => { void read(); };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [key, connection.connected]);
  // A stale response cannot survive a scope/model/run/account/connection transition, even for one paint.
  const value = connection.connected && snapshot?.key === key ? snapshot.value : null;
  if (!value) return null;
  const source = value.source === "execution" ? "当前执行固定账号" : "下次执行默认账号";
  const title = `${source} · ${value.account.label}；官方套餐额度的本地记录${value.usage.stale ? "（旧数据）" : ""}`;
  const email = value.usage.account?.email ?? value.account.email;
  const open = opened?.identity === value.identity;
  return <>
    <button type="button" className="usage-metric action-icon session-account-usage-trigger" data-od-id="session-account-usage" aria-label="查看套餐用量" aria-description={title}
      aria-haspopup="dialog" aria-expanded={open} data-tooltip={`${title}；点击查看详情`}
      onClick={event => setOpened(open ? undefined : { identity: value.identity, trigger: event.currentTarget })}><Icon name="chart-pie" /></button>
    {open && opened && <MetricDetail trigger={opened.trigger} title="套餐用量" subtitle={`${source} · ${value.account.label}`} className="session-account-usage-detail" onClose={() => setOpened(undefined)}
      footer={<a href="/model-accounts.html" target="_blank" rel="noopener noreferrer">管理账号与刷新官方额度</a>}>
      <p className="metric-note">{value.providerId} · {email && <span title={value.usage.account?.email ? "来自官方额度信息" : "来自授权信息，仅供账号区分"}>{email} · </span>}
        {value.source === "execution" ? "按本次执行固定的认证槽显示，不跟随后续全局切号。" : "会话未执行，显示所选模型下次执行的默认账号；不是上次调用的账号。"}</p>
      <ProviderUsage providerId={value.providerId} revision={value.identity} accountId={value.account.id} cached={value.usage} accountMetadata={value.account} progressMode="remaining" />
      <p className="metric-note">仅展示已保存的官方查询记录，不代表本会话的消耗或费用。打开此面板不会发起额度查询或刷新认证；需要新数据时可在多账号管理中刷新。</p>
    </MetricDetail>}
  </>;
}
