/*!
 * Catalog adapted from https://github.com/decolua/9router
 * commit 87a74e1bda3677193c6f71a7e2100c90311f0689.
 * MIT License — Copyright (c) 2024-2026 decolua and contributors
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { NativeModel, NativeThinkingLevel, NativeThinkingLevelMap } from "../contracts.js";

// Compatibility snapshot, not account permissions. Matching DeepSeek limits/images were rechecked
// against CLI 2.179.0; other limits/effort sets retain the existing documented snapshot provenance.
const defaultEfforts: NativeThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];
const catalog: [string, string, number, number, boolean, NativeThinkingLevel[]][] = [
  ["glm-5.2", "GLM-5.2", 1000000, 64000, true, ["high", "xhigh"]],
  ["glm-5.1", "GLM-5.1", 200000, 48000, false, defaultEfforts],
  ["minimax-m3", "MiniMax-M3", 512000, 524288, false, defaultEfforts],
  ["hy3", "Hy3", 192000, 64000, false, ["low", "high"]],
  ["hy4-preview", "Hy4-Preview", 1000000, 64000, false, ["high"]],
  ["glm-5.3", "GLM-5.3", 1000000, 64000, true, ["low", "high", "max"]],
  ["glm-5.3-flash", "GLM-5.3-Flash", 1000000, 131072, true, ["low", "high", "max"]],
  ["kimi-k3-1", "Kimi-K3", 1000000, 1048576, false, defaultEfforts],
  ["kimi-k2.8-preview", "Kimi-K2.8-Preview", 300000, 64000, true, ["low", "high", "max"]],
  ["deepseek-v4-pro", "DeepSeek-V4-Pro", 1000000, 128000, true, ["low", "high", "xhigh"]],
  ["deepseek-v4.1-flash", "DeepSeek-V4.1-Flash", 1000000, 128000, true, ["low", "high", "max"]],
];

export function codeBuddyBuiltinModels(): NativeModel[] {
  return catalog.map(([id, name, contextWindow, maxOutputTokens, canDisable, efforts]) => ({
    id, name, contextWindow, maxOutputTokens,
    input: id === "glm-5.2" || id === "glm-5.1" ? ["text"] : ["text", "image"],
    thinking: { supported: true, levels: {
      off: canDisable ? "none" : null,
      minimal: null, low: null, medium: null, high: null, xhigh: null, max: null,
      ...Object.fromEntries(efforts.map(level => [level, level])),
    } },
  }));
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value);
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** Whitelist metadata only: remote endpoint, headers, credentials, prompts and price claims never propagate. */
export function parseCodeBuddyConfiguration(configuration: unknown, baseline: readonly NativeModel[] = codeBuddyBuiltinModels()): NativeModel[] {
  if (!record(configuration)) throw new Error("CodeBuddy 目录配置格式无效。");
  const result = new Map(baseline.map(model => [model.id, structuredClone(model)]));
  if (configuration.models !== undefined) {
    if (!Array.isArray(configuration.models) || configuration.models.length > 2000) throw new Error("CodeBuddy 模型目录格式无效。");
    const seen = new Set<string>();
    for (const entry of configuration.models) {
      if (!record(entry) || !identifier(entry.id) || seen.has(entry.id)) throw new Error("CodeBuddy 模型目录包含无效或重复标识。");
      seen.add(entry.id);
      const existing = result.get(entry.id);
      const model: NativeModel = existing ?? { id: entry.id, name: entry.id, input: ["text"], thinking: { supported: false } };
      if (typeof entry.name === "string" && entry.name.trim() && entry.name.length <= 256) model.name = entry.name;
      for (const [remote, domain] of [["maxInputTokens", "contextWindow"], ["maxOutputTokens", "maxOutputTokens"]] as const) {
        if (entry[remote] !== undefined) {
          if (!positive(entry[remote])) throw new Error("CodeBuddy 模型目录的限制无效。");
          model[domain] = entry[remote];
        }
      }
      if (typeof entry.supportsImages === "boolean") model.input = entry.supportsImages ? ["text", "image"] : ["text"];
      if (typeof entry.supportsReasoning === "boolean") {
        if (!entry.supportsReasoning) model.thinking = { supported: false };
        else if (!existing) {
          const effort = record(entry.reasoning) ? entry.reasoning.effort : undefined;
          // A declared default is evidence for that effort, not evidence for every level.
          const levels: NativeThinkingLevelMap = { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null };
          if (typeof effort === "string" && Object.hasOwn(levels, effort) && effort !== "off") levels[effort as NativeThinkingLevel] = effort;
          model.thinking = { supported: true, levels };
        } else model.thinking.supported = true;
      }
      // Pi needs both limits to represent a chat model: a usable output cap and a context
      // window for accounting. Entries without them are non-chat assets (image/video
      // generation), so they are skipped instead of failing the whole catalog refresh.
      if (!model.contextWindow || !model.maxOutputTokens) continue;
      result.set(model.id, model);
    }
  }
  const allowed = configuration.availableModels;
  if (allowed !== undefined && (!Array.isArray(allowed) || allowed.some(id => !identifier(id)))) throw new Error("CodeBuddy 可见模型配置无效。");
  // Empty list does not mean all denied. This is a client visibility filter, never authorization.
  const ids = Array.isArray(allowed) && allowed.length ? new Set(allowed) : undefined;
  return [...result.values()].filter(model => !ids || ids.has(model.id));
}
