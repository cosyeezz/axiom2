import type { OAuthCredential } from "@earendil-works/pi-ai";
import { CodeBuddyAccountError, fetchCodeBuddyAccount } from "../../native-providers/codebuddy/account-info.js";
import type { ProviderUsage } from "../../shared/provider-usage.js";

const note = "CodeBuddy 官方 CLI 未提供额度或套餐查询接口，仅显示账号版本。";
/** Edition only; refreshable:false keeps the card from polling. Never refreshes tokens. */
export async function queryCodeBuddyUsage(providerId: string, credential: OAuthCredential, signal: AbortSignal, transport?: typeof fetch): Promise<ProviderUsage> {
  try {
    const info = await fetchCodeBuddyAccount(credential.access, signal, transport), now = Date.now();
    const plan = info.edition === "enterprise" ? info.enterpriseName ? `企业版 ${info.enterpriseName}` : "企业版" : "个人版";
    return { providerId, status: "ready", metrics: [], accountStatus: { state: "active", checkedAt: now }, updatedAt: now,
      account: { plan }, refreshable: false, message: note };
  } catch (error) {
    signal.throwIfAborted();
    const kind = error instanceof CodeBuddyAccountError ? error.kind : "invalid";
    return { providerId, status: "unavailable", metrics: [], accountStatus: { state: kind === "unauthorized" ? "unauthorized" : "unknown", checkedAt: Date.now() },
      message: kind === "unauthorized" ? "CodeBuddy 未接受当前授权，已停止后续查询；请重新登录。"
        : kind === "unavailable" ? "无法读取 CodeBuddy 账号信息，请检查网络后重试。" : "CodeBuddy 账号信息格式无效。" };
  }
}
