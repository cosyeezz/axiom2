# Qoder CLI 静态逻辑对照

对照对象：官方 npm `@qoder-ai/qodercli@1.1.78`，`bundle/qodercli.js` 共 34,562,870 字节，SHA-256 `ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38`。仅静态分析，不运行目标 CLI/JS/WASM、不访问 Qoder 服务、不读取凭据、不改正式 REA 设置。后续资源恢复允许查询及下载必要的官方分析组件，与目标程序的网络访问分开。本报告不代表服务端协议承诺或运行时路径证明。

## 结论

**官方主 Agent 将 `10605` 识别为模型排队，并以专用状态机恢复推理；它不是把所有 403 都当成认证失败，也不是简单等 30 秒原样重放。** 这支持 Axiom 已完成的错误分类修复，但不足以直接复制自动重试。Axiom 继续保留“资源繁忙，稍后重试；未自动重放”的默认行为。

同时发现请求 ID 关系、提示词投影和 reasoning 往返等兼容性差异。它们需要分别评估，不能据静态差异宣称是历史 403 的根因。已成功的真实最小文本/工具调用及其边界见 [Qoder 原生接入](qoder.md)。排队及 reasoning 对照本身未新增自动恢复；后续图像协议证据已用于补齐原生输入，离线验证与真实会话验收仍须分开。

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

**Axiom 暂不照搬自动恢复。** 完整实现须协调请求集身份、队列状态、累计截止时间、取消、部分输出与工具防重复执行、404 终止、租约释放。仅复制 `retryAfterSeconds:30` 会遗漏这些约束。本节静态对照未新增轮询、自动重放或真实调用；另行授权的真实 Axiom 会话验收见原生接入文档。

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

## 图像协议对照

对原始 bundle 的 18 个精确 UTF-8 字节切片逐一核对，来源 SHA-256 和范围保存在 `/private/tmp/axiom-qoder-images.5hoow7p2/ranges-sha256.json`，报告为同目录 `REPORT.md`。这不是 REA 整包成功证据。

- legacy `zVe → dwA → Uzl → mfo/vzl` 与 modern `$8r → UOa → FOa → GTg` 均支持用户及工具图片。base64 输入转换成 `image_url.url = data:<MIME>;base64,<data>`，URL 输入保留；混合数组按顺序同时填写 `content` 和 `contents`。
- 模型目录的 `is_vl` 决定视觉能力；两套 builder 的 `chat_context.imageUrls` 都为 `null`。全 bundle 中两处 `image_urls` 属于 hook／诊断，不是推理顶层字段。
- CLI 通常先尝试上传，但失败时保留 base64，不能认定上传是所有推理的硬前置。本轮不复制未审计的上传／签名流程。
- 支持 PNG/JPEG/GIF/WebP。CLI 的 3,932,160 字节、长边 2000 像素和补到 11×11 属于预处理策略，不是已验证的服务器硬限；“最多五张”来自反馈上传，不能套用为聊天限制。

Axiom 仅按明确的 `is_vl === true` 开放内联图像；用户图文采用上述双字段，工具图片保留 Pi 提升为后继 user 的投影，而不是宣称与官方 tool 原位混合数组完全相同。双字段也进入全历史编码预算，避免先高开销编码再拒绝大图。具体本地限制、离线测试及真实验收边界见 [Qoder 原生接入](qoder.md#图像协议与能力边界)。

## 证据、工具覆盖与限制

本轮实际调用已安装的内置 **REA 6.8.0** 私有 Node/CLI，未启用正式集成或改配置。另以已安装 TypeScript parser 和字节读取独立核对关键函数；后者是补充静态证据，不冒充 REA 全程序分析结果。所有原始分析产物仅存隔离临时目录，不将官方 bundle/WASM 复制到产品。

### 分析预算更正与恢复配置

前两轮失败不是 Qoder 服务端限制：1024 MiB 是 REA 的 worker 默认堆，120,000 ms 则是本次调用主动设置的时限，反而低于 REA 默认的 300,000 ms。此前 5,000 个 semantic nodes、1,000 个 unknown 的保留上限也来自调用参数，不是工具能力上限。

为重新分析**原始完整 bundle**，后续恢复调用采用以下独立进程配置；后续处理须依据实际错误：只有 OOM 才有增加堆的依据，内部超时应先取证定位，而非盲目加堆、重复原参数或转向少数函数切片。不能删除事实、截断 fixpoint 轮数或关闭缓存失效来冒充完整：

| 项目 | 恢复调用配置 |
| --- | --- |
| REA 主进程堆 | `NODE_OPTIONS=--max-old-space-size=12288`，独立 CLI 进程 12 GiB |
| 源分析 worker 堆 | `--max-heap-mb 8192`，8 GiB；与主进程堆分别设置 |
| 单源时限 | `--analysis-timeout-ms 3600000`，60 分钟，覆盖启动、分析及传输 |
| semantic nodes 总量／每文件 | 均为 `1000000` |
| semantic unknowns 总量／每文件 | 均为 `1000000` |
| 外层等待 | 独立监督器 4,200,000 ms，70 分钟，为清理、导出和交付预留时间；不依赖前台工具／MCP 的等待期限 |
| 交付 | `--detail summary --evidence_output <新路径>`；摘要不减少分析工作，完整 Evidence 单独保存 |

前一个使用 900,000 ms 单源时限的前台尝试实际以外层 `Command aborted` 结束，没有 CLI exit 或最终 Evidence，不能据此断言内部 provider timeout。已核实并清理其孤儿 worker。现由独立监督进程保存 PID、精确命令、输入 SHA、实际退出码与耗时，在自有进程组中控制截止时间和清理；2026-10-26 00:54:25（+08:00）启动，01:54:28 结束，真实 **exit 1、signal null、elapsed 3602716 ms**。stdout 明确报告 `provider_timeout / timeout`，消息指出触及 `analysis_timeout_ms=3600000` 的**内部每源 server/provider deadline**，不是外层 70 分钟或 MCP client deadline。没有独立 application Evidence，只有错误中内嵌的 partial observation；`captured_output` 的 null exit 不是实际 CLI exit。

最后进度是 `javascript_worker_static`。该 worker 先 parse、static，再写 checkpoint，所以 partial observation 的 JS 0／AST 0 表示未交付完整保留结果，不能反推“从未解析”；未进入完整 semantic 阶段，关系 0 也不代表没有关系。`time -l` 的 max RSS 为 6481461248 字节（约 6.04 GiB）、swaps 0，无 OOM 证据。已核对本次 supervisor、PGID 和同输入 worker 无残留，未操作无关 REA 进程。原始状态在 [监督运行目录](/private/tmp/axiom-qoder-rea-supervised.WoZqyk/)，独立失败分类与覆盖报告在 [exit1-review](/private/tmp/axiom-rea-exit1-review.n4fi52hi/report.md)。仍只选择了两个文件、另 15 个未选，不能称整个 17 文件包已覆盖。

这些是提高后的**有限预算**，不是“无限模式”；REA 6.8.0 不接受用 `0` 或 `null` 关闭这些参数。主进程剩余堆还决定结果准入；固定 checkpoint／单条 transfer 为 8 MiB、transfer 文件最大 2 GiB，不能靠增大 worker 堆改变。应以实际失败项判断是否触发，不把所有未触发的上限当作失败理由。

恢复验收必须核对原始 bundle 的字节数与 SHA-256、成功解析文件数、AST 节点数、资源失败及保留遗漏。退出 0、摘要 `complete-within-view`、动态值的 `unknown` 和完整程序运行时语义证明，是不同概念。上述独立恢复已确认失败；完整原始 bundle 的零保留遗漏验收仍未达成，不能以切片或后续 CPU 采样替代。

### 原版 120 分钟参数复验

在上述 60 分钟失败及下述取证、候选评估之后，另建完整私有依赖副本，只将单源时限延长到 **7200000 ms（120 分钟）**、外层监督时限延长到 **7800000 ms（130 分钟）**；worker／父 CLI 仍为 8／12 GiB，semantic 四项仍各 100 万，没有增加堆或修改算法。该副本恢复无 inspector 的 pristine worker，未采用 `reverse()`、稳定 join 或 memo；2316 个文件的前置清单与正式 6.8.0 副本一致，正式安装和设置未改。原始输入为 **34562870 字节**，SHA-256 `ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38`。

唯一这次参数复验于 **2026-10-25T20:22:40.678Z** 启动，**22:22:42.878Z** 结束，真实 **exit 1、signal null、elapsed 7202200 ms**，见 [新监督运行目录](/private/tmp/axiom-qoder-rea-supervised.ITaeN9/)；没有并发第二个大分析。stdout 明确报告 `provider_timeout / timeout`，消息指出触及 **7200000 ms 每源 server/provider deadline**，不是 MCP client deadline，也没有触及外层 130 分钟的记录。未生成独立 application Evidence，只有错误内嵌的 partial observation；末阶段仍为 `javascript_worker_static`，返回 JS 0／AST 0／skipped 1 不能反推从未 parse 或没有关系。`time -l` 最大 RSS 为 **7275741184 字节（约 6.776 GiB）**、swaps 0；未见 OOM 标记，不代表排除了宿主级内存问题或宿主从未换页。仍只选两个文件、另 15 个未选，完整原始 bundle 的零保留遗漏验收未达成。先前 [21:40:31Z 快照](/private/tmp/axiom-qoder-rea-120m.jx975Y/progress-20261025T214031Z.json) 的 `running` 只是当时文件状态，已由上述真实终态取代。

首个前台监视工具返回 `Command aborted`，没有数值 exit；这是观察工具失败，不是 REA 退出。旧监视器还有 locale 日期解析和 PGID 范围缺陷，旧记录保留、不用作验收。修复后的只读观察链已于 **2026-10-25T21:04:18Z** 独立启动，没有重启分析；它将 observer 的自报状态、supervisor 真实 wait exit 与 REA 的 exit 分开记录。历史数字 PGID 只用于检查是否仍有成员，不授予陌生进程 ownership；查询错误、身份歧义或退出未确认均不能当作清理成功，不向未知进程发信号。总截止覆盖收尾，但 Timer 安装前的初始读取不受它覆盖；Python Timer 自退仍依赖 GIL、OS 调度及进程可运行性，不是任意暂停条件下的内核硬墙钟保证。

本次 observer 的独立 supervisor 实际记录 **wait exit 1**（22:22:47.517400Z），不是分析 exit 的代用值，也不是因为发现了已登记残留。其两次 quiescence 快照均未见登记 PID/start、已知 PGID 成员或已识别的同 runtime 居民，但两帧都有 PID83610 的 `proc_pidpath ESRCH`，严格状态为 `not-proven-quiescent`；result 顶层的空 `query_errors` 不覆盖这份嵌套错误。后续一次精确只读 `ps` 仅返回出生于 2026-10-22 的 PID83610（`Z`／`<defunct>`），未列出原四个登记 PID 和两个 observer 相关 PID；它不属于本次 owned，未操作或 kill，也不能用后来的 Z 状态追溯改判旧快照。可以说明所列登记身份及组在两帧未见，**不能称全局严格清理已验证**、未知逃逸后代不存在或持续无进程。见 [退出与清理边界复核](/private/tmp/axiom-rea-readonly-audit.md68D8/report.md) 及 [独立运行与验收材料](/private/tmp/axiom-qoder-rea-120m.jx975Y/)。

[独立失败与完整性审计](/private/tmp/axiom-readonly-audit.gbCaL5/REPORT.md) 重新哈希本次私有 dist 的 2316 文件，与 private-baseline、预检时 formal-before／formal-after、observer-after 四份清单逐项相同，原输入及五个终态文件也与记录吻合。额外的 CPU-profile reference 只在 worker entry 上不同；[启动前预检](/private/tmp/axiom-qoder-rea-120m.jx975Y/preflight.json) 已明确从 inspector bootstrap 恢复 pristine，不能混称所有 reference 与 pristine 完全一致。初审把这份 reference 也要求全等，故审计工具实际 **exit 1、22 项中 21 项符合**，失败记录保留；[补充对账](/private/tmp/axiom-readonly-supplement.Cmhi3W/REPORT.md) 的 8 项只读断言及实际 exit 0 确认该唯一差异与预检一致，未重跑或改写旧审计。该预期差异不是运行期间源码漂移的证据，也不改变 REA 的真实失败。未据此增加堆、采用性能候选、追加 profile 或重复整包运行；纸面 rest 增长边仍不是本次超时根因证明。

### 有界性能取证与验收器复核

为定位而非盲目增加内存，创建完整独立依赖副本，仅给该副本的真实分析 worker 加 loopback inspector bootstrap，**正式 REA 安装和设置未改**。launcher 使用 spawn、显式 worker 参数并删除 `NODE_OPTIONS`，所以只给父 CLI 加 profiler 参数不能证明取到了 worker。外部控制器分别通过 2 秒非让步合成循环 stop/write 和 8 秒独立硬 watchdog 测试；硬截止模拟下只清理自己专属 PGID 及精确私有路径，并记录真实可观测的信号／未知 exit，未以 exit 0 伪装。

随后仅一次对原始输入采样 60 秒，worker 仍为 8 GiB、父 CLI 12 GiB、semantic 四项各 100 万。此**中断取证**的源时限 120 秒、外部 soft 80 秒／hard 90 秒，不是把完整分析预算降回 120 秒。inspector 成功保存 5434133 字节、19789 个 profile nodes／41482 个 samples，SHA-256 `c94364aedab9ee99892cb70e9864a4ff3ee1015c39151741b31252e2ff922bd9`；控制器总耗时 62959 ms，主动 TERM 后 CLI 真实退出 **143**，owned remaining 为空、`analysis_complete:false`。这是 CPU 证据，不是成功 Evidence 或另一份完整分析。

按 `timeDeltas` 加权并对递归祖先去重：static 68.38%、parse 1.70%、GC 27.06%、未归属 2.86%。本窗口主要热点是 ambient path resolver/store 工作队列：`indexJavaScriptAmbientWritesSteps` inclusive 约 19.558 秒，其 resolver 闭包 self 约 8.675 秒；`electronMemberPath` self 约 2.589 秒。不能把这一分钟推广成整段 60 分钟的唯一根因或加速比；GC 高也不是 OOM／泄漏证明。旧的 captures、ancestor clone、mutation fixpoint、缓存清理候选尚无全程因果：祖先快照是惰性的，mutation 初次 traversal 已占显著时间，直接 cache 删除仅约 3 ms，不应取消失效或限制收敛轮数。时间桶还显示 15–42 秒偏 ambient、42 秒后偏 member mutation。后续仅对两种独立局部候选做隔离合成验证，未将它们合并；尚无优化后的完整 bundle 复验。详见 [加权热点报告](/private/tmp/axiom-rea-profile-hotspots.PVxdKu/report.md)。

#### 局部数组候选

**局部候选不等于可靠提速。** 在另一个完整私有依赖副本中，仅把 domain `electronMemberPath` 对函数内部新建数组的 `toReversed()` 改为 `reverse()`；候选的 worker entry 另恢复为无 profiler bootstrap 的原版，本次测试不导入 worker／composition／CLI／MCP。Node 24 隔离差分最终 19/19 自生成 fixtures 通过，完整 static result、semantic IR、module／file projection、semantic graph 和 yield 计数的 189 对公开产物逐字一致；另有 1152 次 root 引用、新返回数组、污染隔离和 AST 不变检查。隐藏 WeakMaps 并未直接比较；解析失败例没有 AST，未执行 projection。初期 harness 自身的失败记录保留。见 [合成差分报告](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-rea-SYNTHETIC-verify.zp2cxkax/REPORT.md)。这不证明任意程序、原始 34 MB 输入或全程序语义无损。

直接 helper 微基准完成 5 轮交错、10 个独立进程，均 exit 0；覆盖 depth 0/1/4/16/64、静态／动态／BigInt／optional／wrapper 及 hot/cold/mixed，450 个配对结果全部保留。candidate/baseline 的 ns/query 比率中位数 0.9844，但范围 0.5994–1.4042，153/450 个配对倒退，部分样本仅约 19 微秒，**不足以确认可靠加速**；heapUsed 也不是分配量。更高查询量首试被外部有界截止清理，未当作通过、未混入完成组。见 [完整微基准及所有样本](/private/tmp/axiom-memberpath-bounded.j08v13ig/REPORT.md)。因此未推广到正式安装，未据此重新跑完整目标，也未绕过语义缓存失效或 fixpoint。

#### 投影稳定 join 候选

另建独立私有候选，仅为 ambient resolver 的 expanded join 与 stores 发布 join 增加**充分稳定条件**快路，没有合并上述 `reverse()` 修改。等长且 previous 每槽为 `null`、或与 incoming 严格相等的字符串时，跳过最终不会改变旧值的 join；不满足时完整回退旧逻辑。resolver 仍保留 `finally`，stores 先完成查询和依赖登记，仍区分缺边与已发布 `undefined`；通知顺序、数组身份和 yield 不应因此改变。基线／候选主模块 SHA-256 分别为 `726fee996fe1f6f66b0d7ff7b60c01220a3dab46355473e60e57a4c5f67d4f4c`／`19c78ca2f424a7a6b76e223d3c65156374e9621fb8a1a55ab2dd9f0f9865c14e`。

独立 [合成差分报告](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-rea-projection-verify.f66wb01z/REPORT.md) 完成原 19 加新增 14，共 **33 fixtures、329 对完整产物逐字一致**，包括 33 对保留原始形状的 `full.v8`；unknown／coverage 未删减，另有 1724 次 root、新数组、污染隔离和冻结 AST／快照检查。精确抽取当前谓词，并使用真实 selector join oracle，比较 **20009 对**：3843 个 true 均满足旧 join 稳定条件，16166 个 false 保留旧 join；另比对 60 个 Map 缺边、`undefined`、空数组及冲突状态。监督器及全部 34 个 Node 子进程 exit 0，10.903239 秒；D/C 各 2316 文件首尾 SHA 不变。384 MiB old-space 加 512 MiB RSS 采样停止条件不是 OS 硬内存上限；峰值观测 187760 KiB。这些结果不直接比较隐藏 WeakMaps，也未统计真实私有分支命中，更不证明完整原始 bundle 或任意输入的语义等价。

[静态无损审查](/private/tmp/axiom-rea-static-review.N7q2mA/report.md) 支持的范围是普通 Babel 数据 AST、原生内建、无读取副作用的普通数组／selector 数据；**不泛化到 getter、Proxy、自定义 species／数组方法或污染原型**。previous 中的 selector、`undefined` 或稀疏槽保守回退；incoming 中的这些值仍可能被 previous 的 `null` 正确吸收，不能笼统说所有 selector 输入都回退。跨 query 的 syntax memo 仍未实现：即使提取本身纯语法，外部 AST 入口和 yield 也没有保证整个 resolver 实例处于不可变 epoch，按节点身份缓存可能陈旧，见 [正确集成版本的 memo 审查更正](/tmp/ambient-memo-68-correction-heasz9gw/report.md)。

首轮 [有界微基准](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-rea-bounded-bench.1v0opldx/REPORT.md) 在 73 个完整结果前置对比及 60 个边界对比均相等之后，pilot 阶段触发 256 MiB RSS 采样停止：实际观测 **274.625 MiB**，controller 真实返回 **-9**、shell **137**，含末尾源核对耗时约 0.689 秒；这是测试测量控制器的内存门禁失败，不是 V8 OOM 或外层工具超时。预定 5 轮／10 个正式 child **均未启动**，没有 ns/query、ratio 或倒退计数，不能当成性能通过。更早缺少 `prototypeTarget` 的 harness exit 1 原样保留；修正新 harness 后才发生此次停止。实际 resolver 构造使用 `possibleWrites=true`，每 query 新建 pending／expanded；24 个自 store 在单 query 中制造稳定重访，不是 false 模式预热后的 node-cache 命中。没有增加堆，也没有将 RSS 当分配量或把测试脚本越限归咎为候选生产内存。此失败保留，未混入后续完成组。

随后 [低驻留隔离复验](/private/tmp/axiom-rea-stream-bench.sp1ujcbp/REPORT.md) 保持 128 MiB old-space，使用轻量 Python 控制器、单 variant／单 cell 子进程驻留与计时外统一 GC，完成 2 个独立 pilot 加 5 轮交错的 10 个正式 child，**全部 exit 0**，控制器 exit 0、含前后完整源哈希耗时 14.179 秒。原 73 cells 和 60 边界未缩减；每侧各 2316 文件首尾 SHA 与原 reference manifests 一致。完整值经展开共享身份后做 v8 SHA-256 对比，保留 `undefined`，**不是未规范化 raw v8／全部 alias topology 的比较**；显式 AST／helper／返回数组身份断言及逐轮 checksum 另行通过。Python／Node 采样峰值分别为 31.922／124.953 MiB；驻留隔离及 GC 是测量设计，不是候选本身的内存优化证据。

365 个配对全部保留，candidate/baseline 耗时比的 pooled 几何均值 **0.8086**，但 **91/365 个配对倒退**；5 轮几何均值为 0.8135／0.8044／0.8101／0.8077／0.8075。分层结果如下，均仅代表这些人工输入：

| 路径 | C/D 几何均值 | 倒退配对 |
| --- | --- | --- |
| 完整 resolver join envelope | 0.8766 | 37/145 |
| 完整 stores 发布 envelope | 0.7362 | 39/145 |
| 实际 resolver，stable 自 store | 0.7682 | 0/25 |
| 实际 resolver，low-reuse | 0.9677 | 11/25 |
| 实际 resolver，tail-widen | 0.7672 | 4/25 |

不能只取总体改善：`actual/d0/low-reuse` 全 5 轮 C/D 为 **1.361–1.555**，`store/d1/s0/selector` 为 **1.255–1.388**，长链末槽冲突等另有持续倒退。共同计划以 6 ms 为目标、查询数为完整 100 输入周期，但 **21/730 个正式时段不足 5 ms，最短 4.063 ms**；固定 100 query 预热公平，不证明 JIT 已进入稳态，也没有统计显著性、CPU affinity 或 allocation 测量。所有原始时长、查询数、checksum、比值及倒退保存在上述报告目录。候选仍未采纳：人工稳定混合率不等于原始输入命中频率，窄合成结果不能推出整包收益，未据此修改正式安装、重新运行目标／profile 或宣称 60 分钟问题已解决。

#### Mutation 回灌的纸面边界

后续源码审查区分了固定 context／path 的有限去重与**路径本身增长**。普通 `node = node.next` 逃逸环可由重复前缀、lifetime 和 coverage 截断；固定深度 rest↔spread 的往返也不能单凭代数写法当作增长反例。普通循环 destructuring assignment 通常更早被 unresolved／mixed-assignment 值判定阻断，native-array 门失败后只回灌 fallback。`512` 只是单次额外选择的界，不是全局路径深度或 fixpoint 轮数界。

另一个 `var` 重声明形状提出了不同的**局部纸面增长边**，两份独立源码审查均未在所列 guard 中找到截断：

```js
function f(again, sink) {
  var a = [[]];
  while (again()) {
    var [[, ...a]] = a;
    sink(a[2].x);
  }
}
```

两个 `var` 复用同一 binding，但 declaration 的 reference initializer 未带 assignment 标记，普通 initializer 仍仅为 `[[]]`，因此不同于前述 assignment 分支。固定 rest 前缀 `P=[0]` 持续选到 native 空数组；`sink` 的实参逃逸在检查规则中产生 `[2,"x"] → [0,3,"x"] → [0,1,3,"x"] → …`。这些路径不命中内空数组已有槽，而逃逸失效只映射已有槽，故纸面重算仍保留 `[[]]`；不能用“有限数组必耗尽”直接否定该边。孤立候选无 accessor，getter key 集为空，两项 iteration-only 选择也在 native 判定后跳过；capture 为空，所列 prefix／suffix／lifetime／coverage 去重未闭合此边。

见 [构造及逐行证据](/private/tmp/axiom-rest-prefix-audit.g9xUoh/report.md)、[独立入口与 guard 复核](/private/tmp/axiom-var-rest-review.XOCYaz/report.md)。主代理另以 Python 核对 13 份源及独立 16 份源 SHA，与本次 pristine 副本一致，2277 行实际引用匹配；一条超出文件末尾的空 requested range 明确标记为非引用，前两版严格校验的 exit 1 保留，未改原证据或源码，见 [文本对账](/private/tmp/axiom-qoder-rea-120m.jx975Y/main-rest-paper-check-v3.json)。**上述纸面阶段没有解析或执行该候选，没有新增 REA 运行或 profile，也未证明真实目标包含此形状。** 这只闭合所列源码规则中的局部增长推演，不是已运行反例、全域不终止证明、已确认实现缺陷或原始整包超时根因；未据此修改算法。

#### 单次受限静态复现

随后按明确授权，仅对上述 **7 行／110 字节自建输入**运行一次隔离 REA 6.8 静态复现，不执行输入中的函数，不读取或重跑 34 MB 目标，不联网、不改正式安装或产品。私有副本保持生产 parse → static → semantic 阶段顺序；只加入独立审过的有界观察，不改变 guards、缓存、join、返回值或 fixpoint 轮数。它不是完整 worker／projection／application Evidence 流程。旧预检失败和首审阻断均保留，修正实际 ESM 依赖闭包、加载顺序及启动监督后才执行唯一一次；见 [冻结方案增量复审](/private/tmp/axiom-rea-freeze4-review.wRExc1/report.md) 和 [SIGCHLD／截止监督复审](/private/tmp/axiom-rea-freeze5-review.hLktIQ/review.log)。

**结果：实际观察到有限的 native-array raw-path 回灌增长，而不是仅有纸面推演或三条路径共存。** 原始日志保留 key 类型：

```text
["2","x"] → [0,3,"x"] → [0,1,3,"x"]
```

首项 `"2"` 是静态属性读取产生的字符串，后续 `0`、`1`、`3` 是 rest 投影生成的数值，不将二者静默归一。第 10–12 行记录同一 binding/member 的 accepted → stored → copy；第 14–17 行接续 native replay → accepted → stored → copy。copy 的 initializer 为 RHS `a`，projection=`[0,null]`、offset/start 均为 1、assignment=false；初次 origin 是 `sink` 调用，回灌后为 RHS `a`，memberReadAt 始终是该 `sink` 调用，captures 为 0。可见 replay 均为 knownArray=true、slotStatus=array、iterationOnly=false，源码随后的 `markValue` 选择完整 raw path，**不是 fallback `[0]`**。见 [原始 JSONL](/private/tmp/axiom-rea-rest-repro.aU8GZx/stdout.jsonl) 和 [独立增长链复核](/private/tmp/axiom-rest-offline-independent.uu6ymsmm/report.md)。

日志共 **136 条完整 JSON：8 control＋128 detail**，可见 11 个完整 fixpoint 轮，另有 round 0 初遍及 round 12 的开头；12 条路径已 accepted/stored，最长 length 13，第 132 行 length 14 的路径仅 copied，不能算已接纳。所有可见路径均未触及 path 截断上限；detail 达到日志限额后分析仍可继续，但没有最终 summary，因此后续轮数、丢弃总量、观察失败计数及是否收敛均未知。

运行在 **2026-10-26 02:40:04.800463–02:40:14.813683 UTC**：parse errors=0，static complete／31 AST nodes，semantic 已进入 MemberMutations，但未交付完成记录或 `analysis-result.json`。实际 V8 总 heap limit 为 **494,927,872 bytes＝472 MiB ≤ 512 MiB**；峰值 RSS 为 **174 MiB**（含 exec 前设置阶段），不是 heap 上限。外部 10 秒 deadline 在 elapsed **10.006978 s** 请求 SIGKILL；到 **10.013016 s** 的 reap／Timer 收尾后记录时，直接子进程已回收，此时长不是精确 waitpid 时间戳。真实子进程为 **returncode −9／signal 9**，监督器退出 **1**，不能当正常分析 exit 1 或成功；没有交付完整语义结果。该外部机制依赖 Python／GIL／OS 可调度，不是任意阻塞下的无条件内核硬墙钟。

独立离线复核分别通过 **535 项增长链断言**和 **33 项退出／身份检查**，运行后 **207/207 项冻结 SHA-256 一致**；这些检查的 exit 0 不替代分析的 timeout／SIGKILL。见 [退出与冻结审计](/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-rea-offline-audit.59vqxb99/report.md) 及 [真实退出记录](/private/tmp/axiom-rea-rest-repro.aU8GZx/status.json)。空 stderr 不排除宿主问题；直接子进程回收也不是全局 quiescence 证明。此前写独立审查脚本的 Python 命令曾有一次 SyntaxError／exit 1，失败在正文执行前，原命令记录保留，不是额外 REA 分析。

**结论仅限这次私有、受观测的最小输入上确实发生有限增长。** 它不证明无限执行、全域实现缺陷、真实目标包含此形状或 60／120 分钟整包超时由此导致；观察和同步日志本身也有扰动，不能据此量化未观测原版的性能。未修改算法、未采用修复、未追加第二次分析或 profile；整包 Evidence、retention 和真实 Qoder 工具／图像会话验收仍未完成。

上述临时绝对路径仅供本机证据回溯，不是可移植仓库附件。

#### 保留验收器

验收脚本也经过独立复核。v2 的 70 个明确 synthetic fixtures 暴露 4 个漏拒绝和 1 个误拒绝，原失败保留；按当前集成 6.8 的 schema 修正为 v3，覆盖全部 12 个 family、44 种关系映射及逐族计数、unknown 记录和 family IDs 双向一致性、可选 omission 以及资源／失败状态。正常 builder 的 graph status 可以是 `unknown`、family 为 `partial`，静态不确定性不等于预算遗漏；无遗漏时省略 `omitted_unknown_occurrences`，字段存在则须非空且为正计数。最新 **143/143** 合成断言符合预期（51 正例 exit 0、92 负例 exit 1 且无 success report），harness exit 0，首尾 SHA 一致。见 [v3 回归报告](/private/tmp/axiom-qoder-verifier-v3-test.UzBWwI/REPORT.md)。这些只是 retention assertions，**不是全 schema 校验、内容承诺／真实性证明或真实整包成功**。

外层验收 guard 另要求真实分析 finished／exit 0／signal null、observer 独立实际 exit 0、两次成功进程快照及已发布组清理、输入和 2316 文件清单一致、冻结验收器及精确 argv／Evidence 身份一致；`acceptance/` 和成功报告必须全新，不能复用旧报告。process helper 在普通／`-O` 模式各通过 25 个合成测试，guard 各通过 115 个，观察链另通过 30 项全 mock 生命周期检查；这些不是真实清理、真实 deadline 或真实 Evidence 验证。分析 exit 0 与 verifier 失败／超时必须分别保留；observer exit 0 也只表示观察完成，不能替代分析成功。本次 120 分钟运行真实 exit 1、无独立 Evidence，且 observer 的严格 quiescence 未通过，不满足 guard 前置条件，因此真实 guard／v3 **未执行**，也没有生成 `acceptance/` 或独立成功报告。合成测试不能签收此次失败；全量 retention 验收仍未完成。

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

以上可支持特定函数的静态控制流结论，不是完整程序可达性证明，更不证明服务端实际策略、刷新结果、计费、排队恢复幂等或长期稳定性。静态控制流对照的旧轮次仅更新文档，未重跑当时已通过的 42/42；后续图像／取消／序列化安全修复的最终版本已单独完成 62/62 关联回归、独立复审及 build-5，并经唯一一次 verified 后台重启加载，见原生接入文档；本轮真实 Axiom 首轮文本及 thinking 通过，T2 两次资源繁忙，工具和图片完整会话仍未通过。任何测试结果只适用于受检版本，不代表所有并行工作区改动都已重新验证。
