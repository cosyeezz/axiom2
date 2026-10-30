import type { ModelSummary } from "./protocol.js";
import { providerDisplayName } from "./model-providers.js";

type ModelIdentity = { provider?: string | null; id?: string | null };
const internalId = /^axiom-(copy|model)-/;

/** Presentation only: never change the identity used for requests, selection or billing. */
export function modelDisplay(available: readonly ModelSummary[], identity: ModelIdentity) {
  const configured = available.find(model => model.provider === identity.provider && model.id === identity.id);
  const name = configured?.name?.trim();
  const model = name && !internalId.test(name) ? name
    : !identity.id ? "模型未记录" : internalId.test(identity.id) ? "未知模型配置" : identity.id;
  const provider = configured?.providerName?.trim()
    || available.find(model => model.provider === identity.provider && model.providerName?.trim())?.providerName?.trim()
    || (identity.provider ? providerDisplayName(identity.provider) : "供应商未记录");
  return { model, provider, label: `${provider} / ${model}` };
}
