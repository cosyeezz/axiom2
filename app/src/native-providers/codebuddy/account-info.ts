import { createCodeBuddyJsonRequest, validCodeBuddyToken } from "./json.js";

/**
 * Read-only CodeBuddy account edition. Evidence: CLI 2.179.0 getAccountSnapshot
 * (GET /v2{prefixPath}/accounts, product.json prefixPath "/plugin") and
 * account_utils isPersonalEditionAccount (enterpriseId or type ultimate/exclusive => enterprise).
 * The CLI ships no quota/plan endpoint, so no credit numbers are produced here.
 */
export type CodeBuddyAccountInfo = { edition: "personal" | "enterprise"; enterpriseName?: string };
export class CodeBuddyAccountError extends Error {
  constructor(readonly kind: "unauthorized" | "invalid" | "unavailable", readonly status?: number) { super(`CodeBuddy account ${kind}`); }
}
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const enterpriseTypes = new Set(["ultimate", "exclusive"]);
const safeName = (value: unknown) => typeof value === "string" && value.trim().length <= 48
  && /^[\p{L}\p{N}][\p{L}\p{N} _.+()&/'-]*$/u.test(value.trim()) ? value.trim() : undefined;

export function parseCodeBuddyAccounts(data: unknown): CodeBuddyAccountInfo {
  const list = record(data)?.accounts;
  if (!Array.isArray(list)) throw new CodeBuddyAccountError("invalid");
  const enabled = list.map(record).filter((item): item is Record<string, unknown> => !!item && !!item.pluginEnabled);
  const account = enabled.find(item => !!item.lastLogin) ?? enabled[0];
  if (!account) throw new CodeBuddyAccountError("invalid");
  const type = typeof account.type === "string" ? account.type.trim().toLowerCase() : "";
  const enterprise = typeof account.enterpriseId === "string" && !!account.enterpriseId.trim() || enterpriseTypes.has(type);
  const enterpriseName = enterprise ? safeName(account.enterpriseName) : undefined;
  return { edition: enterprise ? "enterprise" : "personal", ...(enterpriseName ? { enterpriseName } : {}) };
}

export async function fetchCodeBuddyAccount(access: string, signal: AbortSignal, transport?: typeof fetch): Promise<CodeBuddyAccountInfo> {
  signal.throwIfAborted();
  if (!validCodeBuddyToken(access)) throw new CodeBuddyAccountError("invalid");
  let envelope;
  try {
    envelope = await createCodeBuddyJsonRequest({ fetch: transport, requestTimeoutMs: 8000 }, "账号")("/v2/plugin/accounts", {
      method: "GET", headers: { Authorization: `Bearer ${access}` },
    }, signal);
  } catch (error) {
    signal.throwIfAborted();
    const status = (error as { status?: unknown }).status;
    if (status === 401 || status === 403) throw new CodeBuddyAccountError("unauthorized", status);
    throw new CodeBuddyAccountError("unavailable", typeof status === "number" ? status : undefined);
  }
  if (envelope.code === 401 || envelope.code === 403) throw new CodeBuddyAccountError("unauthorized", envelope.code);
  if (envelope.code !== undefined && envelope.code !== 0) throw new CodeBuddyAccountError("invalid");
  return parseCodeBuddyAccounts(envelope.data);
}
