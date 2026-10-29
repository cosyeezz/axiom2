import { randomUUID } from "node:crypto";
import type { KiroCredential } from "./kiro-auth.js";
import { validateKiroCredential } from "./kiro-catalog.js";
import { KiroChatError } from "./kiro-chat-protocol.js";
import { readKiroErrorBody } from "./kiro-failure.js";

/** Enterprise OIDC token responses do not contain the inference profile.
 * Reference: kiro.rs v0.9.2 token_manager.rs::list_available_profiles.
 * Never substitute a personal/shared/BuilderID ARN for an enterprise identity.
 */
export async function resolveKiroProfile(account: KiroCredential, signal: AbortSignal, transport: typeof fetch): Promise<KiroCredential> {
  signal.throwIfAborted();
  if (account.profileArn || account.authMethod !== "identity-center") return account;
  const regions = account.authRegion.startsWith("eu-") ? ["eu-central-1", "us-east-1"] : ["us-east-1", "eu-central-1"];
  for (const region of regions) {
    const profiles = new Set<string>(), tokens = new Set<string>();
    let nextToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      signal.throwIfAborted();
      let response: Response;
      try {
        response = await transport(`https://q.${region}.amazonaws.com/`, {
          method: "POST", redirect: "error", signal,
          headers: { Authorization: `Bearer ${account.access}`, "Content-Type": "application/x-amz-json-1.0", Accept: "application/json",
            "x-amz-target": "AmazonCodeWhispererService.ListAvailableProfiles",
            "amz-sdk-invocation-id": randomUUID(), "amz-sdk-request": "attempt=1; max=1" },
          body: JSON.stringify({ maxResults: 10, ...(nextToken ? { nextToken } : {}) }),
        });
      } catch {
        signal.throwIfAborted();
        throw new KiroChatError("Kiro 企业 profile 查询网络失败；未发送推理请求。");
      }
      if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new KiroChatError(`Kiro 企业 profile 查询失败（HTTP ${response.status}）；请检查组织授权或改用已验证的 Google 登录。未发送推理请求。`);
      }
      // Small discovery responses only. This bounded reader never exposes a raw body.
      const body = await readKiroErrorBody(response, signal);
      signal.throwIfAborted();
      const data = body.data;
      if (body.state !== "json" || !data || !Array.isArray(data.profiles) || data.profiles.length > 100)
        throw new KiroChatError("Kiro 企业 profile 查询响应无效；未发送推理请求。");
      for (const item of data.profiles) {
        if (!item || typeof item !== "object" || typeof item.arn !== "string")
          throw new KiroChatError("Kiro 企业 profile 查询响应无效；未发送推理请求。");
        try { validateKiroCredential({ ...account, profileArn: item.arn }); }
        catch { throw new KiroChatError("Kiro 企业 profile ARN 无效；未发送推理请求。"); }
        profiles.add(item.arn);
      }
      if (profiles.size > 1) throw new KiroChatError("Kiro 企业账号存在多个 profile，需要明确选择账号配置；未自动选择或发送推理请求。");
      if (data.nextToken == null || data.nextToken === "") {
        const [profileArn] = profiles;
        if (profileArn) return { ...account, profileArn };
        break; // Only an explicitly empty success permits checking the other service region.
      }
      if (typeof data.nextToken !== "string" || data.nextToken.length > 8192 || /[\x00-\x1f\x7f]/.test(data.nextToken) || tokens.has(data.nextToken))
        throw new KiroChatError("Kiro 企业 profile 分页无效；未发送推理请求。");
      tokens.add(data.nextToken); nextToken = data.nextToken;
      if (page === 19) throw new KiroChatError("Kiro 企业 profile 分页超过本地限制；未发送推理请求。");
    }
  }
  throw new KiroChatError("Kiro 企业账号未返回可用 profile；请检查组织授权或使用 Windows 上已验证的 Google 登录。未发送推理请求。");
}
