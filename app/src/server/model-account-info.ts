import type { Credential, AuthPrompt } from "@earendil-works/pi-ai";
import type { ModelAccount } from "../shared/model-accounts.js";
import { openAIAccountInfo } from "./providers/openai-account-info.js";

function safeText(value: unknown, maximum = 160) {
  return typeof value === "string" && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value) ? value : undefined;
}
/** Bounded display metadata only; token claims never determine authentication or account selection. */
export function accountInfo(provider: string, credential: Credential | undefined): Pick<ModelAccount, "email" | "emailSource" | "plan" | "accountId" | "login"> {
  if (credential?.type !== "oauth") return {};
  const email = safeText(credential.email, 254);
  if (["openai", "openai-codex"].includes(provider)) return openAIAccountInfo(credential);
  const info: Pick<ModelAccount, "email" | "accountId" | "login"> = {
    ...(email && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? { email } : {}),
  };
  if (provider !== "kiro") return info;
  const method = credential.authMethod, flow = credential.authFlow;
  const authRegion = safeText(credential.authRegion);
  let startUrl: string | undefined;
  try {
    const url = new URL(safeText(credential.startUrl, 2048) ?? "");
    // A Start URL may be local organization information; never expose query/fragment secrets.
    if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) startUrl = url.href;
  } catch { /* Missing optional metadata is not an authentication error. */ }
  info.login = {
    ...(typeof method === "string" && ["builder-id", "identity-center", "social"].includes(method) ? { method: method as "builder-id" | "identity-center" | "social" } : {}),
    ...(authRegion && /^[a-z]{2}(?:-[a-z]+)+-\d$/.test(authRegion) && !authRegion.startsWith("cn-") ? { authRegion } : {}),
    ...(startUrl ? { startUrl } : {}),
    ...(flow === "pkce" || flow === "device" ? { flow } : {}),
  };
  return info;
}
export type KiroLoginField = "method" | "startUrl" | "authRegion" | "flow";
/** App-owned Kiro prompts carry a stable key across worker IPC. Pi itself needs no patch. */
export function kiroLoginPrompt(field: KiroLoginField, prompt: AuthPrompt): AuthPrompt {
  return Object.assign(prompt, { kiroLoginField: field });
}
export function loginPromptDefault(provider: string, prompt: AuthPrompt, credential: Credential | undefined) {
  if (provider !== "kiro" || prompt.type === "secret" || prompt.type === "manual_code") return undefined;
  const field = (prompt as AuthPrompt & { kiroLoginField?: KiroLoginField }).kiroLoginField;
  if (!field || !["method", "startUrl", "authRegion", "flow"].includes(field)) return undefined;
  const value = accountInfo(provider, credential).login?.[field];
  if (!value || prompt.type === "select" && !prompt.options.some(option => option.id === value)) return undefined;
  return value;
}
