# Qoder CLI 静态逻辑对照

对照对象：官方 npm `@qoder-ai/qodercli@1.1.78`，`bundle/qodercli.js` 共 34,562,870 字节，SHA-256 `ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38`。仅静态分析，不运行目标 CLI/JS/WASM、不访问 Qoder 服务、不读取凭据、不改正式 REA 设置。后续资源恢复允许查询及下载必要的官方分析组件，与目标程序的网络访问分开。本报告不代表服务端协议承诺或运行时路径证明。

## 结论

**官方主 Agent 将 `10605` 识别为模型排队，并以专用状态机恢复推理；它不是把所有 403 都当成认证失败，也不是简单等 30 秒原样重放。** 这支持 Axiom 已完成的错误分类修复，但不足以直接复制自动重试。Axiom 继续保留“资源繁忙，稍后重试；未自动重放”的默认行为。

同时发现请求 ID 关系、提示词投影和 reasoning 往返等兼容性差异。它们需要分别评估，不能据静态差异宣称是历史 403 的根因。已成功的真实最小文本/工具调用及其边界见 [Qoder 原生接入](qoder.md)。本轮未修改适配器源码。

## 10605 与排队恢复

### 错误识别

主 Agent 路径中，SSE 错误经 `K2 → Ntt/$Yi/Wee` 解析多层对象与 JSON 字符串。错误归一化在 `error/data/body/message/cause` 字段中查找业务码及队列元数据；只沿选定键遍历并记录已见对象，已知业务码的选择仍受遍历顺序影响。

`10605` 被标记为模型排队，保留外层 403；另有业务 `105` 才改为 401。传输层继续保留队列信息。普通重试判断 `Sht` 明确排除 `model_queued`，交给外层 `CVn → _au → ZBo` 专门处理。官方识别的字段比 Axiom 当前有限的错误分类器多，但不能因此放弃本地深度、长度和脱敏限制。

### 等待与恢复

| 环节 | 官方主 Agent 的静态行为 |
| --- | --- |
| 首次进入队列 | 立即 GET `/api/v2/service/ask/queue/status`，不是先固定等待 30 秒 |
| 状态查询 | 传递 `requestSetId`、`modelKey`、`queueType`；每次传输调用的 timeout 至多 30 秒，响应体上限 64 KiB；鉴权刷新、第二次鉴权尝试和 body 读取仍受传入的剩余排队预算约束，不能保证完整 poll 总耗时不超过 30 秒 |
| 后续查询间隔 | 按有效 `retryAfterSeconds` 计算，钳制在 500 ms–30 s；缺省 30 s |
| 就绪 | 优先判断 `isQueued === false`；如果同一响应给出正有效重试秒数，再等待相应的钳制时长后重新提交 |
| 服务仍不可用 | 未就绪且 `serviceAvailable === false` 时继续查询，而非立即要求重新登录 |
| 等待预算 | 默认累计最多 1 小时；正有限的 `QODER_MODEL_QUEUE_MAX_WAIT_MS` 可覆盖；最多 10 轮排队恢复 |
| 停止 | 连续 3 次状态查询失败，或 404、fatal、取消、预算耗尽时停止；404 不降级为盲目重放 |
| 恢复身份 | 保留 `request_set_id`，同步更换 `request_id` 和 `chat_record_id` |
| 生命周期 | 上层登记排队模型；业务结束或 skill 切换模型时走 `ask/finish` 释放路径；服务端释放/TTL 保证未验证 |

`waitTime` 用于预计等待展示/遥测，不直接作为 sleep 时长。状态 GET 的 401/403 可触发一次 token 刷新，这不等于将推理中的业务 `10605` 当成认证错误。

恢复还受路径限制：`CVn` 只对非 direct 路由且被识别为排队的错误进入上述流程。普通模型请求函数 `qau` 记录已 yield 的工具调用 ID 和不安全 payload，特定条件下返回 `interrupted`，而非抛给外层恢复；仅 reasoning/signature 等输出不受相同阻断。不能将其概括成无条件重放，也不能说任何可见输出都绝对禁止恢复，更不能据此证明服务端幂等。

`ask/finish` 会跳过 service account 或缺少 uid 的场景；交互模式终结不等待释放完成，非交互模式才 await。所谓服务器 TTL 兜底来自客户端日志说明，不是本轮验证的服务端保证。

此外，bundle 内存在 Undici 通用 RetryHandler 和末尾 remoteChat SDK：这些库的默认重试值、错误处理或独立 queue API，不等于主 Agent 采用同一恢复路径。

**Axiom 暂不照搬自动恢复。** 完整实现须协调请求集身份、队列状态、累计截止时间、取消、部分输出与工具防重复执行、404 终止、租约释放。仅复制 `retryAfterSeconds:30` 会遗漏这些约束。本轮不新增轮询、自动重放或真实调用。

## 请求体与身份

官方至少有两套请求构造器：legacy `zVe → dwA`，以及现代 `$8r → UOa/jTg`。可观察到 legacy 的 Agent/utility 调用和现代 transport 注册，但静态注册不证明特定真实请求选择了哪个路径。

| 项目 | 官方静态行为 | Axiom 当前实现与判断 |
| --- | --- | --- |
| 请求 ID | 两套 builder 都使 `request_id === chat_record_id`；`request_set_id` 接受调用者分组或回退到请求 ID | 当前 `request_set_id === chat_record_id`，另生成 request ID；明确存在差异，但无服务端强制等式或故障因果证据 |
| 恢复 ID | `swo` 同步更新 request/record，保留 set | Axiom 不自动恢复；若将来实现，需按逻辑请求维护 set，而非每个 fetch 全部重新生成 |
| 会话 ID | legacy 拒绝全空白；现代 builder 使用传入 ID 或回退 ID | Axiom 使用传入 sessionId 或随机 UUID；未与 CLI 参数校验完全对齐 |
| UUID | CLI 显式参数校验 `8-4-4-4-12` 十六进制外形，不限制 version/variant | UUIDv7 符合该外形；一次 v7 请求的 `10605` 不证明不支持 v7 |
| system | legacy 默认提示块同时在顶层 system 和首条 system message；现代 builder 不自动补重复消息 | Axiom 抽离 system/developer 为顶层字符串；不能仅按 legacy 差异认定无效 |
| 工具调用 | 两套均映射调用 ID、函数名和字符串参数；legacy 带 index，现代不带 | 当前透传上游 OpenAI 格式；不应把 index 的缺失统一判错 |
| 工具专用 assistant | 官方两套通常输出 `content:""` | Axiom 可传 `content:null`，真实两轮工具调用已成功；不定为阻断点 |
| 工具结果 | `role:tool`、`tool_call_id`；legacy 对多块文本通常无分隔拼接，并可保留 `is_error` | Axiom 对文本数组用换行拼接；这是投影差异，不是已证实的 403 原因 |

## Reasoning 往返边界

官方保留 `reasoning_content`、`reasoning_content_signature` 和 `reasoning_item`，包括部分加密/签名内容。legacy 在显式 `generation.reasoning.preserve === false` 时才移除有关字段；这与仅设置模型 `reasoning:false` 或不暴露 reasoning effort 不是同一件事。

本轮进一步只读核对实际安装的 Pi AI 1.1.0，而非仅看 `qoder.ts`：

- `qoder-sse.ts` 的解包层不主动过滤 reasoning 字段。Pi 的 `dist/api/openai-completions.js:396–425` 会读取首个非空 `reasoning_content/reasoning/reasoning_text`，生成 thinking 事件，不以 `model.reasoning` 为门槛。这里 `thinkingSignature` 保存的是 reasoning **字段名**，不是官方 Qoder 签名。
- 同 provider/API/model 续轮的 thinking 块由 `transform-messages.js:68–90` 保留；`openai-completions.js:973–1009` 可按字段名将非空 thinking 写回，例如 `reasoning_content`。工具调用/结果另按 OpenAI 格式输出；`qoder.ts` 对已有 reasoning 字段做浅拷贝保留。因此不是“工具续轮把思考全丢”。
- 但该适配器没有读取/生成 Qoder 的 `reasoning_content_signature`、`reasoning_item`，也不直接读取 `delta.thinking/delta.signature`；这些内容不会自动进入 Pi 输出并在下一轮恢复。Pi 对另一类 `reasoning_details` 的保留，不等价于支持 Qoder 这些字段。
- 跨模型时，普通 thinking 可降为文本，redacted thinking 被丢弃；error/aborted assistant 不重放。即使构造了 reasoning 字段，只有 reasoning、没有正文或工具调用的 assistant 也可能被 OpenAI 投影跳过（`openai-completions.js:1052–1062`）。

已确认的是签名/加密推理元数据的兼容性缺口，而非所有 thinking 文本必定丢失。服务端是否要求这些字段、哪些模型要求、失败会返回什么，静态证据不能回答。不能把该缺口定为历史 403 根因，也不能凭 descriptor 的 `reasoning:false` 宣称服务端已关闭思考。

## 证据、工具覆盖与限制

本轮实际调用已安装的内置 **REA 6.8.0** 私有 Node/CLI，未启用正式集成或改配置。另以已安装 TypeScript parser 和字节读取独立核对关键函数；后者是补充静态证据，不冒充 REA 全程序分析结果。所有原始分析产物仅存隔离临时目录，不将官方 bundle/WASM 复制到产品。

### 分析预算更正与恢复配置

前两轮失败不是 Qoder 服务端限制：1024 MiB 是 REA 的 worker 默认堆，120,000 ms 则是本次调用主动设置的时限，反而低于 REA 默认的 300,000 ms。此前 5,000 个 semantic nodes、1,000 个 unknown 的保留上限也来自调用参数，不是工具能力上限。

为重新分析**原始完整 bundle**，后续恢复调用采用以下独立进程配置；如仍受资源限制，应根据实际错误继续递增，而非重复原参数或转向少数函数切片：

| 项目 | 恢复调用配置 |
| --- | --- |
| REA 主进程堆 | `NODE_OPTIONS=--max-old-space-size=12288`，独立 CLI 进程 12 GiB |
| 源分析 worker 堆 | `--max-heap-mb 8192`，8 GiB；与主进程堆分别设置 |
| 单源时限 | `--analysis-timeout-ms 900000`，15 分钟，覆盖启动、分析及传输 |
| semantic nodes 总量／每文件 | 均为 `1000000` |
| semantic unknowns 总量／每文件 | 均为 `1000000` |
| 外层等待 | 长于单源期限，并为清理、导出和交付预留时间；不经默认 MCP 请求期限 |
| 交付 | `--detail summary --evidence_output <新路径>`；摘要不减少分析工作，完整 Evidence 单独保存 |

这些是提高后的**有限预算**，不是“无限模式”；REA 6.8.0 不接受用 `0` 或 `null` 关闭这些参数。主进程剩余堆还决定结果准入；固定 checkpoint／单条 transfer 为 8 MiB、transfer 文件最大 2 GiB，不能靠增大 worker 堆改变。应以实际失败项判断是否触发，不把所有未触发的上限当作失败理由。

恢复验收必须核对原始 bundle 的字节数与 SHA-256、成功解析文件数、AST 节点数、资源失败及保留遗漏。退出 0、摘要 `complete-within-view`、动态值的 `unknown` 和完整程序运行时语义证明，是不同概念。当前恢复运行的最终结果将在独立证据核验后记录，不预先宣称成功。

### REA JavaScript 首次分析

- 选择 `package.json` 与 `bundle/qodercli.js`，其余 15 个已盘点文件不在选定分析范围；不自动包含依赖。
- 命令退出 0，但 34 MB bundle 在默认 1024 MiB V8 堆上限处解析失败：成功解析 JS 0 个，访问 AST 节点 0 个，application/semantic coverage 均为 **partial**。
- summary 的 `complete-within-view` 只表示摘要视图交付完整，不表示父分析完整；0 findings 不能解释为不存在排队、session 或工具逻辑。
- 父 Evidence `ev_059dc1ba0fddcbb84a19f1a68e5cf018011221a6e734513db88d2056ce102356`；保存包 `/private/tmp/axiom-qoder-rea.yTBruo/application-evidence.json`。

### REA JavaScript 单次内存调整复核

按首轮 Evidence 的恢复建议，仅对新 worker 增加 `--max-heap-mb 4096`，不改正式设置、不覆盖旧产物。结果退出 **1**：此次触及 **120,000 ms 每源 provider 超时**，仍无已交付的 JS/AST 解析成果，不代表完整逻辑图已建立。错误里的 partial Evidence 为 `ev_905ca72c457388417a7087e4e73c4f4e78443c3aab2fd661b8c3209fddd689a3`，保存在 `/private/tmp/axiom-qoder-rea.yTBruo/heap4096/partial-observation.json`；失败未生成请求的完整 Evidence bundle。该阶段停止了完整 bundle 尝试；后续按用户要求重新调整预算，见上方恢复配置。

### REA 关键函数切片分析

前两轮完整 bundle 未成功时，另选 10 个完整函数（共 31,030 字节）作为**明确标识的派生输入**，不改函数正文。派生清单逐一记录原始 bundle 的字节范围、SHA-256，并逐字节验证；输入身份不等于官方完整包。

- 对该切片集合调用 REA，退出 **0**；10/10 JS 解析成功，访问 7,654 个 AST 节点，跳过/解析失败均为 0；application coverage 为 complete，**仅限这些切片**。
- semantic coverage 仍为 partial/truncated：保留 1,000 个 unknown，另省略 703 次 unknown 发射。50 条 call-flow 关系包括 20 条调用、20 条参数传递、10 条返回关系，均应按静态候选理解；没有超时或堆耗尽。
- request/timer 关系为 0 不能解释成“没有请求/等待”：原函数使用封装调用，且省略了部分依赖、全局绑定。跨切片的完整调用链仍须结合原始完整函数独立复核，不冒充 REA 已证明的连接。
- 父 Evidence `ev_18891e714b0f6f6ebb1f4a16a01caba26226f88b7ec7147e7bc0a91df94da570`；完整包为 `/private/tmp/axiom-qoder-rea.yTBruo/focused-output/application-evidence.json`，派生来源见同目录 `derivation-manifest.json`。完整包仅指保存的 Evidence 数据，不表示完整程序语义已恢复。

### REA WASM 静态核验

对前序从同一 bundle 提取的 `embedded-2.wasm` 调用 `inspect-wasm-artifact`，WABT 1.0.42 校验/解码退出 0：

- 298,606 字节，SHA-256 `6419471effa631519def7797d76d7ede38b9fcfa9a83c2148c8ef5d43355b43d`，validation 为 `valid`。
- 31 个 imports、772 个定义函数、34 个 exports；`qodercontext_prepareInferRequest` 为函数 136，`decrypt_server_response` 为函数 209，与前序静态切片定位相符。
- Evidence `ev_7e1c5ebc5f2039a11e6ea8c5a1e97ae0e47bd5af6d2c18891f564f4959841112`；保存于 `/private/tmp/axiom-qoder-rea.yTBruo/wasm-evidence.json`。
- `runtime_execution`、`network_fetch` 均为 `not-performed`。本次没有提供 JS glue，不能仅凭该 Evidence 声称证明了 JS 到 WASM 的运行时数据流或签名逐字节等价。

### 独立控制流证据

- 排队错误及恢复：`/private/tmp/axiom-qoder-queue.wbbXlO/REPORT.md`，96 个完整函数切片，附 AST 范围、UTF-8 字节范围及 SHA-256 清单，并逐字节复核。
- 请求及工具：`/private/tmp/axiom-qoder-body.lyF174/REPORT.md`，17 个精确切片（含会话 ID 正则），附原 bundle 身份、偏移和字节校验。
- 偏移统一以最终清单的零基、半开 UTF-8 字节范围为准，不将初始关键词搜索的字符偏移误当作源码字节位置。

以上可支持特定函数的静态控制流结论，不是完整程序可达性证明，更不证明服务端实际策略、刷新结果、计费、排队恢复幂等或长期稳定性。本轮仅更新文档，未重新运行此前已通过的 42/42 适配器回归或 TypeScript 检查；先前结果不是当前整个并行工作区的新一轮验证。源码若随后变化，应重跑相关检查。
