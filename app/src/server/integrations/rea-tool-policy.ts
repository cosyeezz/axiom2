import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { acquireReaBudget, reaProcessSettled, type ReaProcessOwner } from "./rea-budget-lock.js";
import { reaAutoBudget, reaSettingCaps, reaSettingDefaults, reaTargetBytes, reaTotalDeadlineMs } from "./rea-budget.js";

type Definition = ToolDefinition<any, any, any>;
type Result = Awaited<ReturnType<Definition["execute"]>>;
type Json = Record<string, any>;
const object = (value: unknown): Json | undefined => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
/** Pi's structuredContent is the complete MCP envelope. REA errors may be JSON text only. */
export function reaResultData(result: Pick<Result, "content" | "structuredContent"> & { isError?: boolean }): Json | undefined {
  const envelope = object(result.structuredContent);
  const unwrap = (value: Json) => result.isError || envelope?.isError ? object(value.error) ?? value : value;
  const data = object(envelope?.structuredContent);
  if (data) return unwrap(data);
  for (const block of envelope?.content ?? result.content) {
    if (block.type !== "text" || typeof block.text !== "string" || block.text.length > 1_000_000) continue;
    try { const value = object(JSON.parse(block.text)); if (value) return unwrap(value); } catch { /* Not a structured REA report. */ }
  }
  return undefined;
}
const retryableOperations = new Set(["search_strings", "search_procedures"]);
export function reaRetryLimit(operation: string, result: Result, caps: Record<string, number>) {
  const error = reaResultData(result), limit = object(error?.details?.limit);
  // REA 6.8's supervised regex workers await termination before returning.
  // retryable:false rejects an unchanged retry; ONLY these audited editable
  // budgets allow a changed-budget retry. Never generalize this to timeouts,
  // JS/WASM whole analyses, prose, fixed ceilings, or transport exceptions.
  const resource = error?.details?.resource;
  const known = limit?.setting === "regex.matching_deadline_ms" && resource === "cpu" || limit?.setting === "regex.worker_heap_request_mib" && resource === "memory";
  if (!result.isError || !retryableOperations.has(operation) || error?.code !== "resource_constraint" || typeof error.retryable !== "boolean" ||
      error.details?.operation !== operation || !known || error.details?.cleanup && error.details.cleanup !== "complete" ||
      error.details?.cleanup_report !== undefined || error.details?.cleanup_history !== undefined || !limit || limit.agent_editable !== true ||
      typeof limit.setting !== "string" || caps[limit.setting] === undefined || !Number.isSafeInteger(limit.effective_value) || limit.effective_value <= 0 ||
      !Number.isSafeInteger(limit.minimum) || !Number.isSafeInteger(limit.maximum) || limit.scope !== "rea-runtime" || limit.rea_restart_required !== false) return undefined;
  const value = Math.min(Math.floor(limit.effective_value * 2), limit.maximum, caps[limit.setting]);
  return value > limit.effective_value && value >= limit.minimum ? { setting: limit.setting as string, value, parameter: typeof limit.parameter === "string" ? limit.parameter : undefined } : undefined;
}

/** Decorates only tools registered by the built-in REA MCP extension. Uses public
 * ToolDefinition/executeTool APIs, preserving validation, permissions and nested-call events. */
export function createReaToolPolicy(root: string, options: { budget?: typeof reaAutoBudget; version?: string } = {}) {
  const internal = new AsyncLocalStorage<boolean>();
  let owner: ReaProcessOwner | undefined, retired = false;
  const registered = new Set<string>();
  return {
    attachTransport(transport: ReaProcessOwner) {
      // Pi reconnects implicitly in getClient(), before forwarding a call's
      // AbortSignal. Never let that replace a queued/running call's owner or
      // start unbudgeted initialization. A capability reload creates a fresh
      // policy; a reconnect on this policy is intentionally refused pre-spawn.
      if (owner && owner !== transport) throw Error("REA 连接已更换；为避免重复分析，请重新加载技能与 MCP 后再试。");
      owner = transport;
    },
    wrap<T extends Definition>(definition: T): T {
      if (!definition.name.startsWith("mcp__rea__")) return definition;
      registered.add(definition.name);
      const operation = definition.name.slice("mcp__rea__".length);
      const wrapped: Definition = { ...definition, async execute(id, input, callerSignal, onUpdate, ctx) {
        if (internal.getStore()) return definition.execute(id, input, callerSignal, onUpdate, ctx);
        // Reserve bounded teardown time inside the total wall-clock allowance.
        const deadline = AbortSignal.timeout(reaTotalDeadlineMs - 7500);
        const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
        if (!owner || owner.pid === undefined || retired) throw Error("REA 运行环境未连接或已隔离，未启动分析；请重新加载技能与 MCP。");
        const transport = owner, serverPid = transport.pid;
        const release = await acquireReaBudget(root, transport, signal);
        let uncertain = false;
        try {
          signal.throwIfAborted();
          if (retired || owner !== transport || transport.pid !== serverPid) throw Error("排队期间 REA 连接已失效，未重复分析；请重新加载技能与 MCP。");
          const argumentsObject = object(input);
          if (!argumentsObject) throw Error("REA 工具参数必须是对象。");
          const budget = (options.budget ?? reaAutoBudget)(undefined, reaTargetBytes(argumentsObject, ctx.cwd));
          const caps = reaSettingCaps(budget), defaults = reaSettingDefaults(budget);
          const args: Json = structuredClone(argumentsObject);
          const adjustments: string[] = [];
          const notify = (message: string) => { adjustments.push(message); onUpdate?.({ content: [{ type: "text", text: message }], details: { reaBudget: budget } }); };
          const nested = async (name: string, params: Json) => internal.run(true, async () => {
            const outcome = await ctx.executeTool(`mcp__rea__${name}`, params, { signal });
            if (outcome.isError) throw Error(`REA 自动预算调整未完成（${name}）；未绕过工具权限或自动重复分析。`);
            const data = reaResultData(outcome.result);
            if (!Number.isSafeInteger(data?.revision)) throw Error("REA 预算设置版本不可验证，未继续分析。");
            return data;
          });
          if (operation === "update_analysis_settings" && Array.isArray(args.changes)) {
            for (const change of args.changes) {
              const cap = caps[change.setting];
              if (change.action === "set" && cap !== undefined && (change.value === null || typeof change.value === "number" && change.value > cap)) {
                change.value = cap; notify(`${change.setting} 已限制在自动资源上限 ${cap}。`);
              }
            }
          }
          const control = operation === "inspect_analysis_settings" || operation === "update_analysis_settings" || operation === "binary_session" || operation === "close_binary";
          if (!control && budget.heapMaximumMiB < 128) throw Error("当前可用内存不足以安全启动 REA 分析；已保留系统余量，请等待其他任务完成。");
          let settings: Json[] = [], revision: number | undefined;
          const prior: Json[] = [];
          const explicit = new Set(Object.keys(args));
          // REA 6.7 lacks runtime settings tools; use only documented, offered
          // per-call parameters and never add unknown properties to strict schemas.
          const perCall: Record<string, Record<string, number>> = {
            analyze_javascript_application: { analysis_timeout_ms: budget.operationTimeoutMs, max_heap_mb: budget.heapMiB },
            inspect_wasm_artifact: { command_timeout_ms: Math.min(120_000, budget.operationTimeoutMs) },
          };
          const properties = (definition.parameters as Json).properties ?? {};
          const hasSettings = registered.has("mcp__rea__inspect_analysis_settings") && registered.has("mcp__rea__update_analysis_settings");
          for (const [parameter, value] of Object.entries(hasSettings ? {} : perCall[operation] ?? {})) {
            if (!properties[parameter]) continue;
            const cap = parameter === "max_heap_mb" ? budget.heapMaximumMiB : budget.operationMaximumMs;
            if (args[parameter] === undefined) args[parameter] = value;
            else if (typeof args[parameter] === "number" && args[parameter] > cap) { args[parameter] = cap; notify(`${parameter} 已限制在自动资源上限。`); }
          }
          if (!control && hasSettings) {
            const inspected = await nested("inspect_analysis_settings", { operation });
            if (!Array.isArray(inspected?.settings) || !Number.isSafeInteger(inspected?.revision)) throw Error("REA 预算契约不兼容，未猜测参数或启动分析。");
            settings = inspected!.settings; revision = inspected!.revision;
            const changes: Json[] = [];
            for (const setting of settings) {
              const cap = caps[setting.setting], value = defaults[setting.setting];
              if (setting.agent_editable !== true || cap === undefined || value === undefined || !Number.isFinite(setting.minimum) || !Number.isFinite(setting.maximum)) continue;
              const preferred = ["runtime", "setting"].includes(setting.source) && typeof setting.value === "number" ? setting.value : value;
              const bounded = Math.floor(Math.min(preferred, cap, setting.maximum));
              if (bounded < setting.minimum) throw Error("当前资源低于 REA 最小预算，未启动分析。");
              if (typeof setting.parameter === "string" && properties[setting.parameter]) {
                const existing = args[setting.parameter];
                if (existing === undefined) args[setting.parameter] = bounded;
                else if (typeof existing === "number" && existing > Math.min(cap, setting.maximum)) { args[setting.parameter] = Math.min(cap, setting.maximum); notify(`${setting.parameter} 已限制在自动资源上限。`); }
              } else {
                if (setting.value !== bounded) {
                  prior.push({ setting: setting.setting, action: setting.source === "runtime" ? "set" : "reset", ...(setting.source === "runtime" ? { value: setting.value } : {}) });
                  changes.push({ setting: setting.setting, action: "set", value: bounded });
                  setting.value = bounded;
                }
              }
            }
            if (changes.length) {
              const updated = await nested("update_analysis_settings", { changes, expected_revision: revision }); revision = updated?.revision;
            }
          }
          let result: Result;
          try {
            notify(`REA 自动预算：堆 ${budget.heapMiB} MiB，上限 ${budget.heapMaximumMiB} MiB；分析时限 ${budget.operationTimeoutMs / 1000} 秒，跨会话串行。`);
            result = await definition.execute(id, args, signal, onUpdate, ctx);
            const retry = options.version === "6.8.0" && args.mode === "regex" && definition.annotations?.idempotentHint === true && definition.annotations?.destructiveHint === false && definition.annotations?.openWorldHint === false ? reaRetryLimit(operation, result, caps) : undefined;
            if (retry && !signal.aborted) {
              const setting = settings.find(item => item.setting === retry.setting);
              const parameter = typeof setting?.parameter === "string" && properties[setting.parameter] ? setting.parameter : undefined;
              // Explicit smaller per-call budgets are intentional, not an invitation to override.
              if (setting?.agent_editable === true && setting.value === reaResultData(result)?.details?.limit?.effective_value &&
                  !(typeof setting.value === "number" && ["runtime", "setting"].includes(setting.source) && setting.value < defaults[setting.setting]) &&
                  (!parameter || !explicit.has(parameter))) {
                if (parameter) args[parameter] = retry.value;
                else {
                  if (!prior.some(item => item.setting === retry.setting)) prior.push({ setting: setting.setting, action: setting.source === "runtime" ? "set" : "reset", ...(setting.source === "runtime" ? { value: setting.value } : {}) });
                  const updated = await nested("update_analysis_settings", { changes: [{ setting: retry.setting, action: "set", value: retry.value }], expected_revision: revision }); revision = updated?.revision;
                }
                notify(`REA 确认资源限制可重试：${retry.setting} 提高至 ${retry.value}，仅重试一次。`);
                result = await definition.execute(id, args, signal, onUpdate, ctx);
              }
            }
            const data = reaResultData(result);
            if (data?.code === "cleanup_incomplete" || data?.details?.cleanup !== undefined && data.details.cleanup !== "complete") uncertain = true;
          } finally {
            // Runtime settings are shared by the REA process: restore between tasks.
            if (prior.length && !signal.aborted && !uncertain) await nested("update_analysis_settings", { changes: prior, expected_revision: revision });
          }
          return { ...result!, details: { ...(object(result!.details) ?? {}), reaBudget: budget, reaBudgetAdjustments: adjustments } };
        } catch (error) {
          // A timed-out/cancelled transport is not proof its worker stopped. Close
          // this owned runtime before admitting another task; never replay it.
          uncertain = true; throw error;
        } finally {
          let settled = true;
          try {
            if (uncertain || signal.aborted) {
              retired = true;
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([transport.close(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("REA 清理未在限定时间内完成。")), 5000); })]);
                settled = await reaProcessSettled(serverPid);
              } finally { clearTimeout(timer); }
            }
          }
          catch { settled = false; }
          finally { release(settled); }
        }
      } };
      return wrapped as T;
    },
  };
}
