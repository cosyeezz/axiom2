# Qoder 国内版 1.1.81 修复与验收

本报告保存早先受控 case 的记录；最新图片补丁、08:22 部署及未通过的图片识别见[图片修复报告](qoder-image-repair-1181.md)。旧会话之后出现外部用户运行，原历史边界及“剩余 3 次”不能继续复用，不能把历史 10605 推广到当前所有工具请求。

## 当时受控结论

2026-11-01（+08:00），`qoder-cn / dfmodel`（DeepSeek-Flash），Axiom thinking 选择 `high`：

- **已修复并加载**：裸 finish 计时帧误报缺少 choices、工具参数续帧空 ID 误报 `MALFORMED_TOOL_CALL_STREAM`、Pi 外层可能自动重放 Qoder 失败请求。
- **已实证**：独立 SDK 文本、真实 UI 首轮文本、另一个真实 WS-worker 同会话的连续文本与前文回忆／整数变换。
- **未签收生产可用**：修后两次实际工具请求均在上游 `10605` 处结束，没有进入工具调用、执行或 toolResult。不能用离线工具测试、历史最小工具成功或一次文本成功代替这项验收。

官方 CLI 把 `10605` 分类为 **modelQueued**，有专门的查询、等待和恢复状态机；不是仅凭 403 就判令牌过期，也不能据此认定身份、设备、政策或辅助请求是唯一根因。本实现保留零自动重放，不把不断重发直到成功当作修复。

## 官方证据与最小修复

独立登录及文本基线来自国内官方 `@qodercn-ai/qoderclicn@1.1.81`，macOS arm64；其实际 `bundle/qoderclicn.js` SHA-256 为 `55fa18137d1f6d2ac06f555a9e207e44ff86e7029f18a24a82909bd1435f0b97`。历史静态核验还使用独立国际公开 `@qoder-ai/qodercli@1.1.81` 的 `bundle/qodercli.js`（35,653,383 字节），其 SHA-256 如下，不能混称为国内入口：

```text
dcabbcaece1c0683ee4929ac7c0cf0ea00bbea4d319f5abeaae8216088b9888f
```

CLI 仅作静态证据和独立文本基线，使用自己的正常登录；不复制其凭据、不让它代发 Axiom 请求，不把官方 bundle/WASM 放进产品。以下偏移是该 bundle 的字符定位，不冒称 UTF-8 字节偏移或全程序分析。

| 故障或差异 | CLI 1.1.81 证据 | 当前处理 |
| --- | --- | --- |
| 文本已生成，最终报缺少 choices | remote parser 约 34921667 跳过 notifications／firstTokenDuration 控制帧；SDK 实流有 1 个裸计时帧 | 只放行受限 timing／notifications 结构，未知结构仍失败；独立 SDK 已命中新路径。 |
| 工具首帧正常，参数续帧报 malformed | legacy `sRe` 约 23583500：有 name 的首帧保存 ID，参数续帧按 wire index 找既有调用 | 续帧 `id:""`／null／省略均沿用首帧 ID。仍拒绝初始空 ID、非空 ID 冲突、非法 index／参数类型和最终非对象 JSON。 |
| provider 已 maxRetries:0，外层仍可能重放 | 安装的 Pi 1.4.0 `AgentSession` 另有 generic retry／失败历史省略；修前真实回归出现 10 次而非 1 次请求 | 按失败消息的 provider 归属，对 `qoder`、`qoder-cn` 禁用外层 retry，不改变其他 provider 或独立 compaction 策略。 |
| 版本、头与会话身份混入宿主值 | 1.1.81 auth／legacy sender／WASM 调用链 | 版本、签名 cosyVersion、business.version 同步；封闭 header 白名单；宿主 headers 不透传；原生 session 独立 UUID。 |
| Data-Policy 不能写死同意 | 官方 getDataPolicy 与状态分支 | AGREE／NO_RECORD → agree，未知 → disagree；失败保留旧值，首次失败 disagree；取消传播，不修改账号政策。 |

工具诊断只执行了一次模型调用、没有执行工具。[白名单诊断](evidence/qoder-repair-1181/tool-diagnostic.json)记录：首帧 ID/name 为 string，随后 **4 个**参数续帧 ID 为空串、name 缺省；旧 parser 四次命中同一拒绝条件。不保存真实调用 ID、参数或上游原文。

主要源码：[协议／签名](../app/src/server/providers/qoder-protocol.ts)、[认证](../app/src/server/providers/qoder-auth.ts)、[请求构造](../app/src/server/providers/qoder-client.ts)、[SSE](../app/src/server/providers/qoder-sse.ts)、[provider](../app/src/server/providers/qoder.ts)、[Pi 会话重试策略](../app/src/server/session-retry-policy.ts)。

## 分层验证

| 层级 | 实际结果及边界 |
| --- | --- |
| 源码／离线 | Qoder 五文件 **50/50**，含真实本地 HTTP receiver 的 8 条路径；工具空 ID 修前失败、修后通过，SDK 工具组装与畸形反例均覆盖。 |
| 外层重放 | 三文件 **19/19**；真实 AgentSession 回归修前 `10 !== 1`，修后 qoder／qoder-cn／codebuddy-cn 的空、文本和工具 partial 均不重放、不省略失败历史。 |
| 后续受影响检查 | `qoder-runtime.test.ts` **2/2**；未变的 provider/parser/wire 沿用前项已过覆盖，没有伪称又跑了一次完整 50 项。 |
| 分发产物 | 根 `npm run build` 退出 **0**，包含 bootstrap/native、前端 TypeScript/Vite 和 server 构建；有非阻断大 chunk 警告。 |
| 独立 SDK 实发 | 正常 `ModelService.runtime()` → `ensureModelProvider` → `completeSimple()`，不显式传凭据、不改默认；V5／真实 policy／目录／SSE 全 200，1 次推理，stop、精确答案断言通过，1658 ms，input 125／output 45。 |
| 服务加载 | 该轮独立重启 `94292 → 96136`，00:58:26，HTTP 200、WS connected；工具与外层 zero-replay 补丁均已加载，不是只改磁盘。 |
| UI 首轮 | 正常 React UI 发送，session `ed0c0a95-a4d1-4cbf-9624-1c5ab7280ee6`，run `c9ff190d-0d57-4178-8eb0-593c2ca971e7` completed，3097 ms；provider/model、stop、精确答案通过，input 5302／output 37。随后用户真实工具请求失败促成上述工具修复，首轮成功不能代表会话可用。 |
| 同会话多轮 | 见下表：固定同一 session、同一模型和完整用户历史；通过真实 Axiom WS／worker，不是 SDK 探针，也不冒称每轮 UI 点击。实际工具与结果续轮仍未通过。 |

测试均 exit 0，fail／skip／cancel 为 0；这三组是有边界且有重叠的检查，不能简单相加成独立能力数。早期通用 `model-runtime` 仍有一个 CodeBuddy 注册计数 `2 !== 1`（8/9），未扩大修改，不能把该轮说成全绿。旧的 CodeBuddy 三文件 25/25 只代表当时结果，未在最终轮重跑。

可复核证据：[50 项](evidence/qoder-repair-1181/tool-regression-after.log)、[19 项](evidence/qoder-repair-1181/retry-regression-after.log)、[runtime 2 项](evidence/qoder-repair-1181/runtime-tool-retry.log)、[根构建](evidence/qoder-repair-1181/build-tool-fix-03.log)、[SDK](evidence/qoder-repair-1181/sdk.json)、[重启](evidence/qoder-repair-1181/restart.json)、[UI 只读复核及当前基础健康](evidence/qoder-repair-1181/ui-and-current-health.json)。JSON 仅保留白名单字段；会话报告副本删除了本机 transcript 路径。UI 曾出现独立的 INVALID_SESSION_SUBSCRIPTION 提示，其根因未在本次修复中定位，不把模型请求通过说成所有 UI 提示已消失。

### 同一真实会话的验收门禁

Workspace `0bef5c14-aeeb-4cc6-aba5-61d3fb855c3f`，session `7561b66d-af1e-40b8-81ea-29961d595df5`。隔离目录中只有合成 fixture，随机值不写入报告；没有删失败历史、换模型或每轮新建 session。

| 轮次 | 结果 |
| --- | --- |
| T1 文本／记忆种子 | run `c9598b92-7fce-4e31-9a8d-2562f3d37395`，2952 ms completed，stop、精确答案通过，无工具，input 5040／output 39。 |
| T2 回忆前文并变换整数 | run `119b3b67-96a2-486e-86dc-859f3575207c`，1614 ms completed，stop、精确答案通过，无工具，input 100／output 47。 |
| T3 请求真实 read | run `52ead427-f55e-4328-be0e-4db193e0dc5e`，621 ms failed，MODEL_ERROR，RAM 固定分类 10605；没有工具片段或结果，立即停止 case。 |
| 有界资源观察 | 新 opaque requestSet 的 queue GET：200，isQueued=false、serviceAvailable=true、queueCount=0、retryAfterSeconds=2。它不是原失败请求的恢复。 |
| 同会话新 case 继续工具验收 | 等待至少 2 秒后仅发一条新 prompt，run `eb00a035-bdce-40f3-8e3d-b9f0c477df34`，1194 ms failed，仍为 10605，无工具／结果；再度停止，没有自动重放。 |
| 工具结果后续轮、最后综合回忆 | 未发送；不能越过失败门禁签收。 |

[case02](evidence/qoder-repair-1181/multiturn-service-02.json)、[case03](evidence/qoder-repair-1181/multiturn-service-03.json)、[第二次失败分类](evidence/qoder-repair-1181/multiturn-service-03-failure.json)、[queue 观察](evidence/qoder-repair-1181/queue-observe-02.json)。两个 case 的 `accepted` 都是 false。

测试模型选择会写全局新会话默认；case02 在 SQLite 事务内仅当当前默认仍等于自身测试值时条件恢复，readback 成功，测试会话仍为 Qoder。case03 没有重选模型或修改默认。正式账号与凭据沿正常 Axiom 路由，不改默认账号、不复制 CLI 凭据。

## 10605：已知语义，不是已证根因

CLI 1.1.81 的 `10605 = modelQueued`（约 23864902／23871304）；排队处理约 23749k–23769k，`zIo` 约 23765091 在资源就绪后保留 request_set_id、更新 request_id/chat_record_id。

- 逻辑路径 `/api/v2/service/ask/queue/status`（约 23592782）会经 endpoint 拼接函数 `mK`（约 18806205）加 `/algo`，实际 URL 为 `/algo/api/v2/service/ask/queue/status`，query 为 requestSetId、modelKey、可选 queueType。首个私有观察器漏加 `/algo` 得到 404，已修正；不是供应商资源不可用证据。
- 官方还有排队集合 `ask/finish`（`QEo` 约 23588k）及每用户轮的 business/finish。ask/finish 只释放进入过队列的请求集，不是每次成功推理都调用。
- 当前没有这些完整恢复／辅助生命周期，也没有鉴权后自动重放；不能猜测缺某个辅助请求就是当前 10605 的原因。
- **新 requestSet 的状态 ready 不代表原请求已出队，也不保证下一次实际推理能获得资源。** 两次实际工具请求仍返回 modelQueued；暂不追加盲重发。

[验收合同](evidence/qoder-repair-1181/multiturn-case.json)最多 8 次模型调用、诊断最多 1 次、automaticRetries=0、每 run 90 秒。**截至 case03 的历史受控账本为 5/8**：诊断 1、case02 三次、case03 一次；连接失败和 queue GET 不消费模型调用。但原 session 之后新增外部用户消息和完成运行，原历史边界已失效，不能再宣称“当前剩 3 次”、直接复用旧驱动，或拼接这些运行签收受控工具验收。历史 JSON／verification 仅记录当时状态。失败 claim 不复用，不能静默扩合同。

恢复条件：先核当前会话历史、调用归属及新的明确验收预算，再建立受控 exclusive case 验证真实 read → 同 ID toolResult → 正确答案及综合回忆；不借旧剩余额度，不删失败历史。需要 CLI 式队列恢复时，还须明确新策略，保留取消、部分输出及工具防重放边界，不能直接套通用 429 重试。

## 八条准则逐项状态

| 准则 | 状态与证据范围 |
| --- | --- |
| 1 只发 CLI 协议字段 | **限定已证**：构造白名单；本地真实 HTTP receiver 覆盖 poll、refresh、PAT exchange、userinfo、V5、policy、目录、SSE 八路径，含隐式头与注入剥离。未实现的辅助路径不声称已验。 |
| 2 字段值同源 | **限定已证／差异**：版本、签名版本、auth 与 undici UA、实际架构来自 CLI 证据；政策查真实状态。没有真实 UMID 不伪造；不称所有身份字节相同。 |
| 3 不额外带出本地身份 | **已证于上述构造／本地 wire**：无自动 hostname、宿主 session、内部账号映射头；session 按账号映射独立 UUID。保留真正的 system/history/tools，不清洗上下文来制造成功。 |
| 4 验实际发出请求 | **限定已证／未验**：八路径经本地原生 HTTP receiver，不只比较 headers 对象。在线 SDK observer 只证明传给原生 sender 的字段及响应，不是远程全 wire／直连 TLS 抓包；在线 PAT／refresh 尚未验。 |
| 5 行为对齐 | **已修局部／已知差异**：finish 计时与空工具 ID 按 CLI 修正；排队恢复、辅助 finish、鉴权重放未实现。保留非空工具 ID 冲突拒绝、更严格控制帧校验及 finish+最终 usage 后一秒空闲结束。 |
| 6 不伪造 | **已证于实现／本次流程**：Axiom 与 CLI 独立正常认证，不复制 CLI 缓存、不修改政策同意、不构造假 UMID／权限。目标不是规避识别。 |
| 7 不夸大一致范围 | **已落实**：源码、产物、SDK、服务、UI／WS 分列；HTTPDNS、traceparent、完整图片、跨进程 session、长期稳定及其他认证路径均未全验，不称整体一致或生产可用。 |
| 8 证据白名单 | **已落实于所存证据**：只留字段名、固定分类、类型、计数、状态和断言；原始认证、上下文、工具参数、未知错误仅 RAM；不以其 hash 代替。CLI bundle 的上述 hash 仅标识公开发布物。 |

其他差异：session 映射为每 provider 进程内最多 256 项，退出或淘汰后会变化；Data-Policy 跟随五分钟目录缓存而非 CLI 十五分钟。没有自动换模型或提高上下文计费档。真实 PAT、新登录／到期 refresh、国际站、用户／工具图片、所有模型与长期运行仍未验收。

## 文档与证据核验

[只读校验脚本](evidence/qoder-repair-1181/verify.mjs)检查当前文档链接、9 份白名单 JSON、三组 TAP 计数、同会话归属和 5/8 调用预算；[结果](evidence/qoder-repair-1181/verification.json)退出 0，`liveAccepted:false`。这不是新增产品回归或远程实测。两篇旧文档另有 17 个历史临时产物／日志链接已缺失，已注明且不计入当前证据，不伪称所有历史资料仍可复核。

## 重现离线检查

在 `app/` 下运行；这些是已执行命令，不要求为纯文档修改再跑一遍：

```sh
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_MANAGED_ACCOUNTS \
  TMPDIR=/private/tmp ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs \
  --test --test-concurrency=1 \
  tests/qoder-auth.test.ts tests/qoder-stream.test.ts tests/qoder-runtime.test.ts \
  tests/qoder-parity.test.ts tests/qoder-wire.test.ts

env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_MANAGED_ACCOUNTS \
  TMPDIR=/private/tmp ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs \
  --test --test-concurrency=1 \
  tests/session-retry-policy.test.ts tests/native-retry.test.ts tests/retry-state.test.ts

env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_MANAGED_ACCOUNTS \
  TMPDIR=/private/tmp ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs \
  --test --test-concurrency=1 tests/qoder-runtime.test.ts
```

根目录构建命令为 `npm run build`。修改期间没有与覆盖这些文件的测试并发写源码；最后代码构建／加载后仅改文档、证据副本和私有驱动，不再重复重启。账号额度／quota 功能及其他会话工作不包含在本修复范围。
