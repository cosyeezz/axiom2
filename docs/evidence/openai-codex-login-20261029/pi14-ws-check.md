# Pi 1.4.0 与 WebSocket 复核

核查时间：2026-10-29 10:02 UTC。只读安装文件、ESM 模块解析与公开上游资料；未读取凭据、登录、调用模型、升级或修改产品代码。

## 结论

- 本机全局 `pi` 是 **1.4.0**。可执行文件解析至 `/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`，它的嵌入 pi-ai 也是 1.4.0。
- 当前 Axiom 根／app 清单与安装依赖仍是 **1.1.0**。已观察到运行中的 agent worker 入口为 `/Volumes/D_Work/axiom2/app/dist/server/agent-worker.js`；该文件保留对 Pi 的外部 ESM imports。以此入口做 Node ESM 解析，pi-ai 与 coding-agent 都解析至 `app/node_modules` 的 1.1.0，而非全局安装。此检查定位当前工作区及观察到的 worker，不是对其他安装／服务器的判断；不声称捕获了实际推理连接。
- 即使只看 **Pi 1.4.0**，`openai` direct adapter 仍为 **HTTP/SSE**；`openai-codex` adapter 支持 **WebSocket**。升级全局 CLI 不会自动升级 Axiom SDK；升级 SDK 到 1.4.0 也不会自动让 direct 走 WS。
- OpenAI 明确给出 WS 的有条件性能观察：20+ 工具调用的执行链，端到端最多约快 40%。不是每次请求／token 生成提速保证，也不能当作 Axiom direct 的已测结果。

## 本机与 npm 源码证据

[只读核验脚本](pi14-local-check.mjs)与[完整输出](pi14-local-check.json)包含模块解析、清单 SHA256、当前全局 adapter 的原文摘录／行号／SHA256，以及源码断言结果。运行命令：

```bash
node --experimental-import-meta-resolve /tmp/axiom-pi14-ws/local-check.mjs
```

脚本不导入／执行 SDK。断言通过；网络调用 0。脚本保留本机绝对路径，是本次研究快照，不是产品测试入口。

官方 npm 的两个 1.4.0 tar 包均核验 SHA512 integrity 和 SHA1。主代理复核全局安装的 `openai-responses.js`、`openai-codex-responses.js`、`providers/openai.js` 与已校验 npm 解包文件逐字节相同。[npm 来源及校验值](pi14-npm-manifest.json)、[上游源码逐行摘录](pi14-upstream-excerpts.md)。

| 实现 | 1.4.0 npm 源码定位 | 确定行为 |
|---|---|---|
| OpenAI provider | `providers/openai.ts:9–30` | API Key 与 ChatGPT OAuth 都路由到公共 Responses adapter；换 OAuth 不启用另一个 WS adapter |
| direct 请求 | `api/openai-responses.ts:220–228`；本机编译 JS 第149行 | `client.responses.create(...).withResponse()`，`stream:true`；整份 adapter 未读取 transport、无 WS／continuation 分支 |
| Codex 传输 | `api/openai-codex-responses.ts:309–386` | 默认 auto 优先 WS；开始输出前的传输失败才可降级 SSE，输出后不透明重放；session 可能固定 fallback SSE |
| Codex 增量 | 同文件 `1447–1498`、`1540–1608` | 显式 auto／websocket-cached、会话连接可复用且历史前缀／其他请求参数一致时，`previous_response_id`＋input delta；否则发全量 |
| coding-agent 默认 | `dist/core/settings-defaults.js:4`、`sdk.js:285` | 默认显式传 auto。裸 pi-ai 省略 transport 时虽尝试 WS，内部原始 options 检查不启用 delta；普通 websocket 模式也不等于 cached continuation |

源码 TypeScript 由 npm 随包 sourcemap 的 sourcesContent 原样提取，非可变分支。官方[完整 v1.4.0 发布正文](pi-release-v1.4.0.md)已读取，未声明新增 direct WS；结论以实现为准，不以“发布说明没提”单独证明功能不存在。

## 官方性能声明

来源：[OpenAI WebSocket mode](https://developers.openai.com/api/docs/guides/websocket-mode)，[官方 Markdown 完整快照](websocket-mode-official.md)第9–13行；[抓取元数据](websocket-mode-official.meta.json)记录 HTTP 200、URL、时间与 SHA256。

> WebSocket mode is most useful when a workflow involves many model-tool round trips (for example, agentic coding or orchestration loops with repeated tool calls).
>
> Because the connection stays open and each turn sends only incremental input, WebSocket mode reduces per-turn continuation overhead and improves end-to-end latency across long chains. For rollouts with 20+ tool calls, we have seen up to roughly 40% faster end-to-end execution.

这说明提速有官方观察依据，不应只描述成未经证实的理论潜力。收益来源是持久连接、增量输入和活跃连接的内存状态复用；文档没有在该处公开完整 SSE 基准配置／统计方法，也没有保证任意模型、账号或客户端得到同一提升。

[官方 HTTP streaming 指南](https://developers.openai.com/api/docs/guides/streaming-responses)区分 `stream=true` 的 SSE 与持久 WS 增量输入。两者都流式输出，不能把这40%写成“非流式 vs 流式”的收益。

direct 是否允许 WS 另由[Sign in with ChatGPT Preview 限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)约束：允许同一认证连接内 continuation，不是跨连接持久存储。通用 Responses WS 文档的其他功能、存储／ZDR政策和API Key能力不能自动套给 direct OAuth。本次没有真实连接或性能 A/B。
