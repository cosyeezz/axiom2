const internalId = /^axiom-(copy|model)-/;
/** Presentation only: never change the identity used for requests, selection or billing. */
export function modelDisplay(available, identity) {
    const configured = available.find(model => model.provider === identity.provider && model.id === identity.id);
    const name = configured?.name?.trim();
    const model = name && !internalId.test(name) ? name
        : !identity.id ? "模型未记录" : internalId.test(identity.id) ? "未知模型配置" : identity.id;
    const provider = configured?.providerName?.trim()
        || available.find(model => model.provider === identity.provider && model.providerName?.trim())?.providerName?.trim()
        || identity.provider || "供应商未记录";
    return { model, provider, label: `${provider} / ${model}` };
}
//# sourceMappingURL=model-display.js.map