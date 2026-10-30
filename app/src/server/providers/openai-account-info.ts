import type { OAuthCredential } from "@earendil-works/pi-ai";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const openAIEmail = (value: unknown) => typeof value === "string" && value.length <= 254 && /^[^\s@<>\x00-\x1f\x7f]+@[^\s@<>\x00-\x1f\x7f]+\.[^\s@<>\x00-\x1f\x7f]+$/.test(value) ? value : undefined;
export const openAIAccountId = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,160}$/.test(value) ? value : undefined;
export const openAIPlan = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : undefined;
function claims(token: unknown) {
  if (typeof token !== "string" || token.length > 32768) return {};
  const parts = token.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return {};
  try { return record(JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))); } catch { return {}; }
}
/** Display metadata only, not JWT verification or an authentication/authorization decision.
 * Sub2API oauth.go / account_codex_import.go use top-level email and the auth namespace.
 * Pi's Codex grant discards id_token, so access-token claims are a best-effort fallback.
 */
export function openAIAccountInfo(credential: OAuthCredential) {
  const id = claims(credential.id_token ?? credential.idToken), access = claims(credential.access);
  const auth = record(access["https://api.openai.com/auth"]), idAuth = record(id["https://api.openai.com/auth"]);
  const explicit = openAIEmail(credential.email), email = explicit ?? openAIEmail(id.email) ?? openAIEmail(access.email);
  const accountId = openAIAccountId(credential.accountId) ?? openAIAccountId(idAuth.chatgpt_account_id) ?? openAIAccountId(auth.chatgpt_account_id);
  const plan = openAIPlan(credential.plan_type) ?? openAIPlan(credential.planType) ?? openAIPlan(idAuth.chatgpt_plan_type) ?? openAIPlan(auth.chatgpt_plan_type);
  return { ...(email ? { email, ...(!explicit ? { emailSource: "token" as const } : {}) } : {}), ...(accountId ? { accountId } : {}), ...(plan ? { plan } : {}) };
}
