import type { StreamFn } from "@earendil-works/pi-agent-core";
import { convertToLlm, generateSummaryWithUsage, serializeConversation, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type SimpleStreamOptions, type RetryPolicy, type Usage } from "@earendil-works/pi-ai";
import { assertCompressionBudget } from "./compression-request.js";
import { compactionInstructions } from "./compaction-display.js";

type Preparation = SessionBeforeCompactEvent["preparation"];
class BatchBudgetError extends Error {}

function addUsage(total: Usage | undefined, usage: Usage): Usage {
  if (!total) return { ...usage, cost: { ...usage.cost } };
  return {
    input: total.input + usage.input, output: total.output + usage.output,
    cacheRead: total.cacheRead + usage.cacheRead, cacheWrite: total.cacheWrite + usage.cacheWrite,
    totalTokens: total.totalTokens + usage.totalTokens,
    cost: { input: total.cost.input + usage.cost.input, output: total.cost.output + usage.cost.output,
      cacheRead: total.cost.cacheRead + usage.cost.cacheRead, cacheWrite: total.cost.cacheWrite + usage.cost.cacheWrite,
      total: total.cost.total + usage.cost.total },
  };
}

/** Use Pi's ordinary summary request when it fits. If even that serialized
 * request is too large, fold every transcript fragment into a cumulative native
 * summary. No fragment is dropped and only the final result can be committed.
 * dispatch owns physical-request accounting (including failed/cancelled batches).
 */
export async function streamNativeCompression(
  model: Parameters<StreamFn>[0], context: Parameters<StreamFn>[1], options: SimpleStreamOptions,
  preparation: Preparation, dispatch: StreamFn, retry?: RetryPolicy,
): Promise<Awaited<ReturnType<StreamFn>>> {
  let fits = true;
  try { assertCompressionBudget(model, context, options); }
  catch { fits = false; }
  // Provider failures must propagate, not trigger a different billable request.
  if (fits) return dispatch(model, context, options);
  const users = context.messages.filter(message => message.role === "user");
  const prompt = users.length === 1 ? (typeof users[0].content === "string" ? users[0].content
    : users[0].content.filter(part => part.type === "text").map(part => part.text).join("\n")) : "";
  const history = serializeConversation(convertToLlm(preparation.messagesToSummarize));
  const turn = serializeConversation(convertToLlm(preparation.turnPrefixMessages));
  let text: string, previous: string | undefined;
  // Match known native strings by their exact lengths, never by a delimiter
  // supplied by a user inside the conversation.
  if (prompt.startsWith(`<conversation>\n${history}\n</conversation>\n\n`)) {
    text = history; previous = preparation.previousSummary;
  } else if (preparation.isSplitTurn && prompt.startsWith(`# Conversation\n${turn}\n\n# Instructions\n`)) {
    text = turn;
  } else throw Error("原生摘要请求协议已变化，未发送分批摘要。");
  if (!text) throw Error("没有可分批摘要的会话消息。");
  const outputTokens = options.maxTokens ?? model.maxTokens;
  const reserveTokens = Math.ceil(outputTokens / 0.8);
  const focus = `${compactionInstructions}\n\nThe user message contains a consecutive fragment of a serialized transcript, not a new task. Merge it into the previous structured summary, preserving pending work, constraints and exact identifiers. Do not execute tools or continue the task. Fragments may split a long message; do not infer missing text.`;
  let offset = 0, usage: Usage | undefined;
  while (offset < text.length) {
    options.signal?.throwIfAborted();
    // Leave a margin for provider tokenization and the native summary template.
    let length = Math.min(text.length - offset, Math.max(256,
      Math.floor((model.contextWindow * 0.7 - outputTokens - (previous?.length ?? 0) / 4 - 2048) * 4)));
    while (true) {
      // Do not divide a surrogate pair between fragments.
      if (length > 1 && /[\uD800-\uDBFF]/.test(text[offset + length - 1])) length--;
      try {
        const result = await generateSummaryWithUsage([
          { role: "user", content: text.slice(offset, offset + length), timestamp: Date.now() },
        ], model, reserveTokens, options.apiKey, undefined, options.signal, focus, previous, options.reasoning,
        (target, request, generated) => {
          const requestOptions = { ...options, ...generated, headers: options.headers };
          try { assertCompressionBudget(target, request, requestOptions); }
          catch (error) { throw new BatchBudgetError((error as Error).message); }
          return dispatch(target, request, requestOptions);
        }, options.env, retry, undefined, options.sessionId);
        options.signal?.throwIfAborted();
        if (!result.text.trim()) throw Error("分批摘要返回空内容，未应用压缩。");
        previous = result.text;
        usage = addUsage(usage, result.usage);
        offset += length;
        break;
      } catch (error) {
        if (!(error instanceof BatchBudgetError) || length <= 1) throw error;
        length = Math.floor(length / 2);
      }
    }
  }
  const message: AssistantMessage = {
    role: "assistant", api: model.api, provider: model.provider, model: model.id,
    timestamp: Date.now(), content: [{ type: "text", text: previous! }], stopReason: "stop", usage: usage!,
  };
  const result = createAssistantMessageEventStream();
  result.push({ type: "done", reason: "stop", message });
  result.end();
  return result;
}
