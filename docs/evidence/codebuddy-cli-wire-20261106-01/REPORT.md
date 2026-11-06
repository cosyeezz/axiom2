# 官方 CLI vs Axiom：同条件真实 wire 对照（2026-11-06 / 07）

## 结论

**两侧已用同一账号（Axiom account `wbcn`）、同一模型 `deepseek-v4.1-flash`、同一 `reasoning_effort: none` 真实拿到 HTTP 200 与完整 SSE。**

- 官方 CLI 2.181.0：`assistantExact: true`，stdout 精确 marker。
- Axiom 原生 sender：`start → text → usage → done(stop)`，干净终态，200 / 4848B SSE。

request 侧 header **名称集合（除 CLI 自身追踪/账号字段）与 body 字段集合已逐项一致**。

早期一轮（同一账号旧凭据）两侧都曾 429 `code 6004`；换新号后已恢复。

产物：[cli-live-success.jsonl](cli-live-success.jsonl)、[axiom-live-success.jsonl](axiom-live-success.jsonl)（成功轮）；[cli-2.181.0.jsonl](cli-2.181.0.jsonl)、[axiom-fixed.jsonl](axiom-fixed.jsonl)（429 轮）。

## 对照表（`POST /v2/chat/completions`）

| 项 | 官方 CLI 2.181.0 | Axiom（修复后，成功轮） | 判定 |
|---|---|---|---|
| status | 200 | 200 | 一致 |
| UA | `CLI/2.181.0 CodeBuddy/2.181.0` | `CLI/2.179.0 CodeBuddy/2.179.0` | 版本号各自跟随 |
| `accept` | `application/json` | `application/json` | 一致 |
| `x-product` | `SaaS` | `SaaS` | 一致 |
| `x-ide-type` / `x-ide-name` | `CLI` / `CLI` | `CLI` / `CLI` | 一致 |
| `x-agent-type` | `main` | `main` | 一致 |
| `x-agent-intent` | `craft` | `craft` | 一致 |
| `x-agent-runtime` | `other` | `other` | 一致 |
| `x-agent-purpose` | `conversation` | `conversation` | 一致 |
| `x-root-request-id` | = `x-conversation-request-id` | 同关系 | 一致 |
| `x-conversation-message-id` / `x-request-id` | 二者相等 | 二者相等 | 一致 |
| body keys | model/messages/stream/stream_options/reasoning_effort/max_tokens/temperature/cache_retention/**extra_vars** | 同前 8 项 | 仅缺 `extra_vars` |
| `cache_retention` | **`long`** | `long` | 一致 |
| `temperature` | `1` | `1` | 一致 |
| `max_tokens` | `128000` | `128000` | 一致 |
| `reasoning_effort` / `reasoning_summary` | `none` / 不存在 | 同 | 一致 |
| 请求体字节 | 13179（gzip） | 312（明文） | 未压缩 |
| 连接 | `keep-alive` | `close` | 无复用 |
| roles | `system,user` | `system,user` | 各自真实上下文 |

仅 CLI 发送、Axiom 有意不发：`b3`、`baggage`、`traceparent`、`x-b3-*`、`x-trace-id`、`x-domain`、`x-private-data`、`x-user-id`、`x-stainless-*`、`extra_vars`。均为 CLI 追踪/Stainless SDK/账号属性/内部埋点，按接入准则不伪造。

## 本轮新增修复（第二阶段抓包驱动）

`cache_retention` 原本硬编码 `"short"`，**真实新号抓包显示是 `"long"`**。已改为按 CLI `resolveCacheRetention` 语义：显式值优先，否则 `CODEBUDDY_DISABLE_PROMPT_CACHING_1H` 为真时 `short`，默认 `long`。同时把 `cacheRetention` 从 Pi 输入校验里的"禁用"项移出（改由 native 决定）。

## 第一轮已修复的 6 处（同一文件）

`accept` 改为 `application/json`；补 `X-Agent-Type/Intent/Runtime/Purpose`；补 `X-Root-Request-ID`；补 `cache_retention`；补默认 `temperature: 1`。

## 验证

- `tests/codebuddy-*.test.ts`：**94/94 通过**。
- `npx tsc --noEmit` 0；`npm run build` 0。
- 两侧真实 200 + 完整流（本轮抓包）。
- `configuration.catalog`（UI 同路径）：ok=true，37 模型。

## 未验证 / 已知差异

- 未做逐帧 SSE 结构对齐（CLI 4856B vs Axiom 4848B，文本长度不同因为两侧 system prompt 不同）。
- `extra_vars`、gzip、keep-alive、CLI 重试策略未实现。
- 抓包走局部代理，不等于直连 TLS/socket 层一致。
- 非 off 思考档位的 `reasoning_summary` 未做真实对照。

