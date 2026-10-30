import type { ReactNode } from "react";
import type { ProviderUsage as Usage } from "../../shared/provider-usage.js";
import { providerDisplayName } from "../../shared/model-providers.js";
import type { ModelAccount } from "../../shared/model-accounts.js";
import { modelAccountPresentation } from "../../shared/model-account-presentation.js";
import { ProviderUsage } from "./ProviderUsage.js";

/** Shared card chrome stays in AccountCard; providers extend only this information panel. */
export function ModelAccountUsage({ account, revision, enabled, children }: { account: ModelAccount; revision: string; enabled: boolean; children?: (usage: Usage | undefined) => ReactNode }) {
  const presentation = modelAccountPresentation(account);
  const reference = presentation.metricIds ? { providerId: account.providerId, label: providerDisplayName(account.providerId), metricIds: presentation.metricIds,
    title: "费用估算", scopeNote: "按本机同窗口计价外推，尚未按账号拆分；多账号混用或其他设备消费会使结果偏差。非官方余额，各窗口不可相加。" } : undefined;
  return <section className="account-provider-panel" data-presentation={presentation.kind} aria-label="账号额度">
    <ProviderUsage windowReference={reference} accountId={account.id} providerId={account.providerId} revision={revision} enabled={enabled} accountLayout heading={presentation.label} summaryFirst
      progressMode={presentation.kind === "openai-subscription" ? "remaining" : "used"} accountMetadata={{ email: account.email, plan: account.plan, accountId: account.accountId, emailSource: account.emailSource, type: account.type, expiresAt: account.expiresAt }}>
      {children}
    </ProviderUsage>
  </section>;
}
