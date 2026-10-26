import { randomUUID } from "node:crypto";
import { getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { object, QoderError } from "./qoder-protocol.js";
import { positiveInteger, qoderEffort, qoderFeatureSelections, qoderLimit, qoderReasoning, qoderSupportsContext, record } from "./qoder-catalog.js";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
export function qoderBudgetEffort(budget) {
    return budget <= 0 ? "none" : budget <= 1024 ? "low" : budget <= 8192 ? "medium" : budget <= 24576 ? "high" : budget <= 49152 ? "xhigh" : "max";
}
// Independent implementation of the published generation contract (JT/iAe/Uji).
export function qoderGeneration(value) {
    const generation = record(value), result = {};
    if (!generation)
        return result;
    if (finite(generation.temperature) && generation.temperature >= 0)
        result.temperature = generation.temperature;
    if (finite(generation.topP) && generation.topP >= 0 && generation.topP <= 1)
        result.top_p = generation.topP;
    if (positiveInteger(generation.topK))
        result.top_k = generation.topK;
    if (positiveInteger(generation.maxTokens))
        result.max_tokens = generation.maxTokens;
    const reasoning = record(generation.reasoning);
    if (!reasoning)
        return result;
    const effort = qoderEffort(reasoning.effort), rawThinking = record(reasoning.thinking);
    const thinking = rawThinking && (["disabled", "adaptive"].includes(String(rawThinking.type)) || rawThinking.type === "enabled" && positiveInteger(rawThinking.budgetTokens)) ? rawThinking : undefined;
    const disabled = !thinking && (reasoning.enabled === false || effort === "none");
    const budget = thinking?.type === "enabled" ? positiveInteger(thinking.budgetTokens) : !thinking && !disabled ? positiveInteger(reasoning.budgetTokens) : undefined;
    const resolvedEffort = thinking?.type === "disabled" || disabled ? "none" : effort && effort !== "none" ? effort : budget ? qoderBudgetEffort(budget) : undefined;
    if (resolvedEffort)
        result.reasoning_effort = resolvedEffort;
    if (thinking?.type === "disabled" || disabled)
        result.enable_thinking = false;
    else if (thinking?.type === "adaptive" || budget || reasoning.enabled === true)
        result.enable_thinking = true;
    if (budget)
        result.reasoning_budget_tokens = budget;
    if (typeof reasoning.preserve === "boolean")
        result.preserve_thinking = reasoning.preserve;
    return result;
}
function optionsFrom(input, body) {
    // metadata is useful to SDK callers; samplingParams.qoder is also editable in Axiom's model body editor.
    return { ...record(body.qoder), ...record(input?.metadata?.qoder), ...input };
}
function modelProjection(config, options, modelId) {
    const override = options.customModelOverride, byok = !!override || config.source === "user" && config.server_scene !== "byok_enterprise";
    if (override && (!record(override) || typeof override.api_key !== "string" || !override.api_key.trim()))
        throw new QoderError("Qoder 自定义模型配置缺少 API Key。");
    const projection = {
        key: byok ? "custom_model" : config.key, display_name: config.display_name ?? config.key,
        ...(config.outer_provider ? { outer_provider: config.outer_provider } : { model: "" }),
        format: config.format ?? "openai", is_vl: override?.isVl ?? !!config.is_vl, is_reasoning: !!config.is_reasoning,
        api_key: "", url: "", source: byok ? "system" : config.source ?? "system", max_input_tokens: qoderLimit(config.max_input_tokens, 200000),
        ...(config.custom_provider_adapter ? { custom_provider_adapter: config.custom_provider_adapter } : {}),
    };
    let custom;
    if (byok) {
        const providerValue = override ? override.provider : config.provider;
        const providerRaw = typeof providerValue === "string" ? providerValue.trim() : "";
        const provider = providerRaw && providerRaw.toLowerCase() !== "custom" ? providerRaw : undefined;
        const type = override?.type ?? config.type, style = override?.style ?? config.custom_model_style;
        const upstreamModel = record(config.server_model)?.model;
        const name = typeof upstreamModel === "string" && upstreamModel ? upstreamModel : finite(upstreamModel) ? String(upstreamModel) : config.model || config.key;
        custom = { ...(provider ? { provider, ...(typeof type === "string" && type.trim() ? { type: type.trim() } : {}) } : {}),
            model: override ? modelId : name, parameters: { ...record(config.byok_parameters), ...(override ? { api_key: override.api_key } : {}) },
            ...(!provider ? { url: override ? override.url ?? "" : config.url ?? "", ...(typeof style === "string" && style.trim() ? { style: style.trim() } : {}) } : {}) };
    }
    return { projection, custom };
}
const replayFormat = "qoder.v1";
export function qoderReplaySignature(signature) {
    if (typeof signature !== "string")
        return;
    try {
        const details = JSON.parse(signature);
        if (!Array.isArray(details))
            return;
        for (let i = details.length - 1; i >= 0; i--) {
            const detail = record(details[i]);
            if (detail?.type === "reasoning.encrypted" && detail.format === replayFormat && typeof detail.data === "string")
                return record(JSON.parse(detail.data));
        }
    }
    catch { /* Foreign provider signatures are never treated as Qoder metadata. */ }
}
export function qoderReplayDetail(value) {
    return { type: "reasoning.encrypted", format: replayFormat, data: JSON.stringify(value) };
}
function contentParts(content, supportsVision) {
    if (typeof content === "string")
        return [{ type: "text", text: content }];
    if (!Array.isArray(content))
        throw new QoderError("Qoder 消息内容格式无效。");
    return content.map(raw => {
        const block = object(raw);
        if (block.type === "text" && typeof block.text === "string")
            return { type: "text", text: block.text };
        if (block.type !== "image" || typeof block.mimeType !== "string" || typeof block.data !== "string")
            throw new QoderError("Qoder 不支持此消息附件类型，请先转换为文本或图片。");
        if (!supportsVision)
            throw new QoderError("Qoder 所选模型不支持图片，请选择账号目录中的视觉模型。");
        if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(block.mimeType.toLowerCase()))
            throw new QoderError("Qoder 图片仅支持 PNG、JPEG、GIF 和 WebP；文档需先转换为文本。");
        if (!block.data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(block.data))
            throw new QoderError("Qoder 图片 Base64 格式无效。");
        return { type: "image_url", image_url: { url: `data:${block.mimeType};base64,${block.data}` } };
    });
}
export function qoderMessages(context, model, supportsVision, preserve = true) {
    const system = getCurrentSystemPrompt(context.messages), messages = [];
    // The official legacy request carries the system prompt in BOTH locations.
    if (system)
        messages.push({ role: "system", content: system });
    for (const message of context.messages) {
        if (message.role === "system")
            continue;
        if (message.role === "user" || message.role === "toolResult") {
            const parts = contentParts(message.content, supportsVision), hasImage = parts.some(part => part.type === "image_url");
            const content = hasImage ? parts : parts.map(part => part.type === "text" ? part.text : "").join(message.role === "user" ? "\n" : "");
            if (message.role === "user" && !hasImage && !String(content).trim())
                continue;
            messages.push({ role: message.role === "user" ? "user" : "tool", content,
                ...(message.role === "user" || hasImage ? { contents: parts } : {}),
                ...(message.role === "toolResult" ? { tool_call_id: message.toolCallId, ...(message.isError ? { is_error: true } : {}) } : {}) });
            continue;
        }
        if (message.stopReason === "error" || message.stopReason === "aborted")
            continue;
        const text = message.content.filter(block => block.type === "text").map(block => ({ type: "text", text: block.text }));
        const calls = message.content.filter(block => block.type === "toolCall").map((block, index) => ({ id: block.id, type: "function", index, function: { name: block.name, arguments: JSON.stringify(block.arguments) } }));
        const sameProvider = message.provider === model.provider && message.api === model.api;
        const thinking = preserve && sameProvider ? message.content.filter(block => block.type === "thinking") : [];
        const reasoningText = thinking.filter(block => !block.redacted).map(block => block.thinking).join("");
        let signature, item;
        for (const block of thinking) {
            // Opaque replay metadata belongs to a particular provider and model, not a transferable prompt.
            if (message.model !== model.id)
                continue;
            const replay = qoderReplaySignature(block.thinkingSignature);
            const entries = Array.isArray(replay?.entries) ? replay.entries : replay ? [replay] : [];
            for (const raw of entries) {
                const entry = record(raw);
                if (entry?.signature)
                    signature = entry.signature;
                if (record(entry?.item))
                    item = record(entry?.item);
            }
        }
        if (reasoningText && !item)
            item = { type: "reasoning", summary: [{ type: "summary_text", text: reasoningText }] };
        const content = text.map(block => block.text).join("");
        if (!content && !calls.length && !reasoningText && !item)
            continue;
        messages.push({ role: "assistant", content, ...(text.length ? { contents: text } : {}), ...(reasoningText ? { reasoning_content: reasoningText } : {}),
            ...(signature ? { reasoning_content_signature: signature } : {}), ...(item ? { reasoning_item: item } : {}), ...(calls.length ? { tool_calls: calls } : {}) });
    }
    return { system, messages };
}
export function buildQoderRequest(body, config, region, model, context, input) {
    const options = optionsFrom(input, body), { projection, custom } = modelProjection(config, options, model.id);
    const parameters = { ...qoderGeneration(options.generation) };
    // Named Pi options and model sampling overrides are serialized into this intermediate body.
    const sampling = qoderGeneration({ temperature: body.temperature, topP: body.top_p, topK: body.top_k, maxTokens: body.max_tokens ?? body.max_completion_tokens });
    Object.assign(parameters, sampling);
    const bodyEffort = qoderEffort(body.reasoning_effort);
    if (bodyEffort)
        parameters.reasoning_effort = bodyEffort;
    for (const key of ["enable_thinking", "preserve_thinking"])
        if (typeof body[key] === "boolean")
            parameters[key] = body[key];
    if (positiveInteger(body.reasoning_budget_tokens))
        parameters.reasoning_budget_tokens = body.reasoning_budget_tokens;
    if (body.tool_choice !== undefined)
        parameters.tool_choice = body.tool_choice;
    if (body.context_length !== undefined)
        parameters.context_length = body.context_length;
    const explicitMax = positiveInteger(input?.maxTokens) ?? positiveInteger(record(options.generation)?.maxTokens);
    parameters.max_tokens = explicitMax ?? parameters.max_tokens ?? qoderLimit(config.max_output_tokens);
    const capability = qoderReasoning(config);
    const configuredEffort = qoderEffort(parameters.reasoning_effort);
    const budget = typeof options.thinkingBudget === "number" && Number.isFinite(options.thinkingBudget) ? options.thinkingBudget : undefined;
    const defaultEffort = qoderEffort(config.default_effort);
    const effort = qoderEffort(options.reasoningEffort) ?? (projection.is_reasoning && budget !== undefined ? qoderBudgetEffort(budget) : undefined)
        ?? (configuredEffort === undefined && parameters.enable_thinking !== false ? defaultEffort : undefined);
    const constrained = Array.isArray(capability.efforts) || capability.supportsDisabled;
    const allowed = capability.efforts ?? [];
    if (effort && (!config.outer_provider && !constrained || allowed.includes(effort) || effort === "none" && capability.supportsDisabled)) {
        const previous = configuredEffort;
        parameters.reasoning_effort = effort;
        parameters.enable_thinking = effort !== "none";
        if (effort === "none")
            delete parameters.reasoning_budget_tokens;
        else if (budget !== undefined && budget > 0)
            parameters.reasoning_budget_tokens = budget;
        else if (previous !== effort)
            delete parameters.reasoning_budget_tokens;
    }
    if (parameters.reasoning_effort === "none" || parameters.enable_thinking === false) {
        projection.is_reasoning = false;
        delete parameters.reasoning_budget_tokens;
    }
    const window = options.contextWindow ?? parameters.context_length;
    delete parameters.context_length;
    if (qoderSupportsContext(config, window))
        parameters.context_length = window;
    const { system, messages } = qoderMessages(context, model, !!projection.is_vl, parameters.preserve_thinking !== false);
    const text = [...messages].reverse().find(message => message.role === "user" && typeof message.content === "string")?.content ?? "";
    const requestId = options.requestId || randomUUID(), sessionId = input?.sessionId || requestId;
    const features = qoderFeatureSelections(config, options.functionSwitchSelections);
    const business = { ...(options.business ?? { product: "cli", version: "1.1.78", type: "agent", stage: "start", id: randomUUID(), name: String(text).slice(0, 30), begin_at: Date.now() }), ...(features ? { feature_switches: features } : {}) };
    return {
        request_id: requestId, request_set_id: options.requestSetId || requestId, chat_record_id: requestId, session_id: sessionId,
        ...(options.sourceSessionId ? { source_session_id: options.sourceSessionId } : {}), ...(options.customContext !== undefined ? { custom_context: options.customContext } : {}),
        stream: true, chat_task: "FREE_INPUT", is_reply: true, is_retry: false, source: 1, version: "3", session_type: region === "cn" ? "qoderclicn" : "qodercli",
        agent_id: "agent_common", ...(options.omitTaskId ? {} : { task_id: options.taskId ?? "common" }), aliyun_user_type: "",
        system, messages, tools: body.tools ?? [], parameters,
        chat_context: { text, features: [], extra: { context: [], modelConfig: { key: config.key, is_reasoning: projection.is_reasoning }, originalContent: text }, chatPrompt: "", imageUrls: null },
        model_config: projection, ...(custom ? { custom_model: custom } : {}), business,
        ...(options.patches && Object.keys(options.patches).length ? { patches: options.patches } : {}),
    };
}
//# sourceMappingURL=qoder-client.js.map