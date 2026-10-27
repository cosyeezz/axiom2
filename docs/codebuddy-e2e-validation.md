# CodeBuddy：AXIOM 真实长会话验证

验证日期：2026-10-26（本机时间）。本报告补充[国内版接入说明](codebuddy-cn.md)和[官方 CLI 静态协议核验](codebuddy-protocol-audit.md)。模拟测试、静态分析和其他客户端的行为，均不代替 AXIOM 端到端验收。

> 最终结果：同一真实会话共发送 **36 轮，33 轮通过（32 轮正常完成、1 轮预设主动停止），3 轮失败（29、31、36）原样保留**。第 32–35 轮显式关闭/重新开启一次通过；第 36 轮证明 DeepSeek 实际 worker 版本且原生 thinking 为 0，但违反纯 JSON 输出契约，整轮仍失败。专项 **22/22**、生产构建、受影响测试 **217/217** 通过；全量保留 **2 个 FIFO 断言失败、54 skip**，不能宣称全绿。

## 1. 真实链路与证据

- 实例：本地开发 AXIOM `http://127.0.0.1:4317`，运行编译后的服务；未混用 4319 的旧实例。本任务未发起整体后台重启，不将其他会话的运维活动当作受控重启验证。
- 设置显示 **Workbuddy**，实际 provider ID 是 **`codebuddy-cn`**，走腾讯 CodeBuddy CN 接口。显示名称不证明 WorkBuddy 独立协议、账号或额度互通。
- 在**同一条会话**中串行使用 `glm-5.3` 和 `deepseek-v4.1-flash`，通过真实 Chrome 页面输入、选择模型/思考等级、粘贴图片。WebSocket 观察 AXIOM 执行和流式消息，并用于明确记录的空闲测试 scope 控制；没有直接调用供应商 API 代替 UI 发送。
- workspace：`b64c057e-96ee-435a-a078-a501e8f0d128`；session：`1376ff09-11f2-4491-b150-b9f7878db4e2`。
- 依赖：Pi `1.1.0`、OpenAI SDK `7.19.0`、Node `22.23.2`。
- [本机证据目录](../artifacts/codebuddy-e2e-20261026/)包含 [逐轮记录](../artifacts/codebuddy-e2e-20261026/turns.json)、[统计摘要](../artifacts/codebuddy-e2e-20261026/evidence-summary.json)、逐轮截图、UI 观察、命令日志及真实退出码。该目录被 Git 忽略，**不是随仓库提交的永久附件**；原生会话 JSONL 也仅在本机数据目录。本文自含必要结论，不包含认证信息或模型内部思考正文。

## 2. 修复前的连续 21 轮

| 轮次 | 场景 | 实际核验 |
| --- | --- | --- |
| 01–03 | 文本、结构化 Unicode、推理 | 记住初始代号/项目/预算；正确返回 JSON；余数题答案 23，有实际 thinking 输出 |
| 04–08 | 工具与副作用 | 真实 read、write、同次双 edit、bash 断言；总价 99、余额 38；同一助手消息包含两个 read 调用 |
| 09 | 工具错误恢复 | 预设 ENOENT 后读取正确文件，未创建缺失文件 |
| 10 | GLM 关闭思考 | 本轮原生 assistant thinking 长度为 0；不据单轮推断关闭策略始终可靠 |
| 11–12 | 图片与图片历史 | UI 上传→read 返回 image 块；标题、算式和三个图形正确；后续无工具回忆正确 |
| 13–17 | 切换 DeepSeek | 早期上下文保留；概率题 1/3；read+bash；图片 read；off 本轮 thinking 为 0 |
| 18–21 | 较长上下文与持久化 | 接收 120 条数据；完整 60 行 Unicode；回忆第 17/91/119 条；页面刷新后继续 |

21 轮全部通过，共 32 条原生助手响应、12 次工具调用。basic、vision、deepseek、long 的页面异常及观察连接错误均为空。此阶段最大单次输入 **13,342 tokens**（input + cacheRead + cacheWrite）。120 条数据不是 120 轮；同消息双 read 不保证底层并行；没有验证百万上下文或自动压缩。

原图两次工具结果各为 **13,769 个解码字节**，base64 长度 18,360。旧 runner 将后者误标为 bytes，统计已按原生记录纠正。DeepSeek 第 16 轮重复 GLM 已看过的图片，不能排除历史答案影响，后续用全新图片补验。

## 3. 修复后真实回归及保留失败

| 轮次 | 结果 | 证据与边界 |
| --- | --- | --- |
| 22 | 通过 | 真实 bash 核对编译响应适配器 SHA 和实际 worker 祖先/出生时间，确认不是旧缓存进程；worker PID 81975 |
| 23 | 通过 | GLM 新图 `FRESH L4N7`，82−37=45，左紫三角、右橙圆；解码 11,196 bytes |
| 24 | 通过 | DeepSeek 新图 `FRESH Q9M2`，64+29=93，左黄菱形、右青矩形；解码 10,880 bytes，排除旧图答案污染 |
| 25–26 | 通过 | 两模型各一次短回复 off，原生 thinking 均 0；仍只是对应轮次的观测 |
| 27 | 通过（预设取消） | 先观察真实流式内容，再点击 UI 停止；终态 `cancelled / USER_STOPPED`，原生助手尾部 0 条 |
| 28 | 通过 | 主动停止后恢复；四个互异正整数乘积 36 的最小和 12，早期代号/预算正确，有 thinking |
| 29 | **失败** | completed、无 provider error，但违反禁止工具和严格文本契约；保留原失败，不重放 |
| 30 | 通过 | 刷新后无工具回忆代号、预算、ledger 状态、第 91 条数据及两张新图，全部正确 |
| 31 | **失败** | 80 行 Unicode 逐字复制正确、无工具，但 GLM/off 仍返回 **13 个非空 thinking 字符**，关闭契约失败 |

截至第 31 轮，共 46 条原生助手响应、17 次工具调用，最大观测输入 **20,128 tokens**。29 个通过项中包括预设取消，不能全部写成正常 completed。没有自动重放失败轮次；第 30、31 轮是调查后明确追加的新场景。

### 第 29 轮：输出/指令契约失败，不冒认传输故障

run `3872f815-4f66-4365-bc53-2d936a39ffe9` 产生 3 条原生助手消息，调用 write 和 bash。模型先输出重复、错误平方及异常说明，误写 fixtures 之外的进度文件，随后自行用 bash 删除；最终虽然含完整正确的 80 行块，仍多出纠错前言。严格相等断言正确失败，误写文件已核实不存在。

1202 个流事件中，3 个同消息序列分别增长 12→2301、13→160、8→1523。原 runner 的文本断言先失败，后续增量断言没有执行；这些增长是离线证据，不改判本轮通过。[隔离保真诊断](../artifacts/codebuddy-e2e-20261026/regression-29-diagnosis.json)对 3 段已观察文本各做 4 种 SSE 字节分片，共 12 项均字节保真；**没有捕获原上游 SSE，因此不能确定归因供应商，也不证明端到端成功**。不通过删除前言、禁掉历史工具或丢弃输出伪造通过。

原 regression 在失败时没有持久化完整 UI 观察文件，故其 pageErrors/transportErrors 不能补填为空。runner 已改为在 finally 中保存 UI 观察；[regression-tail UI 记录](../artifacts/codebuddy-e2e-20261026/ui-regression-tail.json)确认第 30、31 轮仅两次 UI prompt，页面/观察连接错误均为空。第 31 轮同消息有 120 个不同正长度（22→1406，约 5393ms），但其原增量断言同样因 off 先失败而未执行。

AXIOM 主动停止会退休并终止 worker；业务 cancelled 不承诺模型部分回复已持久化为原生 aborted。第 27 轮分别保留流式截图、取消终态和原生尾部记录，不把其差异误归为 provider 错误。

## 4. 接入缺陷、根因与修复

异常处理使用隔离 mock fetch、假 key 和敏感哨兵复现，**未在真实账号中刻意触发超限、撤销凭据、限流或额度耗尽**。这些测试定位边界缺陷，不是实际账号异常恢复验收。

### 4.1 上下文溢出机器语义丢失

旧 HTTP 处理丢弃 `error.code=context_length_exceeded`，HTTP 400/200 业务错误可能成为泛化错误，Pi `isContextOverflow` 返回 false。新增[响应适配器](../app/src/server/providers/codebuddy-response.ts)，在 SDK 前规范白名单 code/type 和固定脱敏文案，保留 `context_length_exceeded` 语义；覆盖 HTTP、嵌套 SSE error、命名 event:error、顶层字符串 code/type。

### 4.2 SSE 错误早于 provider hook 抛出，泄露原文

OpenAI SDK 在后置 provider event hook **之前**因 data.error/event:error 抛错。旧 hook 既来不及脱敏，也无法稳定恢复溢出类型；隔离复现中敏感哨兵进入原生 errorMessage。

[供应商入口](../app/src/server/providers/codebuddy-cn.ts)现在以 `codeBuddyFetch` 包裹实际 fetch，在 SDK 解析前替换已识别错误帧，仅保留固定文案和允许的机器语义，不转发原始 message、metadata 或请求回显。正常帧保留内容；增量 TextDecoder、CR/LF/CRLF 帧边界、多 data 行及 pipeThrough 保持流式、背压和取消传播，不整段缓冲回复。

### 4.3 认证、权限、额度不能误归网关或溢出

HTTP 200 业务 401/403 保留认证/权限状态，11102→403，6004→429，未知业务错误→400，保留 retry-after，不新增认证自动重放。

复审发现嵌套字符串 error.code 遮蔽外层数字码，例如外层 6004 被内层 overflow 字符串误导。现分别解析内外层，已知认证/权限/额度数字码优先。12 个混合分类 probe 由 3/12→12/12；相关回归已进入[流测试](../app/tests/codebuddy-stream.test.ts)。

以上修复不删 system、tools 或历史，不改 node_modules，不改正常文本/thinking/tool/usage。仅有自然语言 message、没有 error/业务码/白名单类型的未知 SSE 帧不在分类范围；transport rejection 和响应 body 读取异常也不在本次统一脱敏审计范围。

### 4.4 off 省略不是可靠的关闭信号

第 31 轮推翻了“短回复几次 thinking=0 就证明关闭策略可靠”的推断。真实链路为：UI off→Pi Agent `reasoning:undefined`→模型 `thinkingLevelMap.off="none"`→SDK 生成 `reasoning_effort:"none"`，但旧 CodeBuddy onPayload 随后删除了 none。

当前实现保留显式 none；hook 提供 off 也归一为 none，关闭时去掉 summary，开启的合法 effort 仍附加 summary:auto。**不隐藏收到的 thinking**，新增测试故意让 mock 返回 thinking 并要求仍可见。

先得到 2 条红测试，再修适配器。新增测试曾误用公共类型不支持的 reasoning:"off"，导致一次生产构建 exit2；已按 Agent 真正使用的 undefined 修正，未用 cast 掩盖。修后专项 22/22、生产构建 exit0，失败日志仍保留。下一节两模型真实新版本运行均观察到 thinking 块字符数 0，GLM 还验证了重新开启；这不保证正文永远没有解题说明，也不保证所有后续请求均遵守开关或输出格式。

## 5. 显式关闭与重新开启验收

第 32–35 轮仅执行一次、全部通过，suite exit0、恰好四次 UI prompt，页面异常/观察连接错误/native 读取警告均为空。[冻结清单](../artifacts/codebuddy-e2e-20261026/off-freeze-manifest.json)绑定源码、测试、编译模块、runner 和成功构建日志的 SHA。新轮次逐一核对 UI 选择、run.selection 的 provider/id/thinking 与原生助手 model。

| 轮次 | 模型/等级 | thinking 字符（native） | 工具 | 结果 |
| --- | --- | ---: | --- | --- |
| 32 | GLM/off | 0 | 1 bash | 四模块 SHA、新 worker 祖先/出生、早期记忆均通过 |
| 33 | GLM/off | 0 | 无 | 80 行 Unicode 全文精确相等；同消息流式正长度 10→1327、181 个不同值，约 13 秒 |
| 34 | DeepSeek/off | 0 | 无 | 严格 JSON：乘积 72 的互异三数 `[3,4,6]`、最小和 13，check 非空 |
| 35 | GLM/max | 907 | 无 | 严格 JSON：n=2248、q97=23、q89=25，两条余数等式正确，重新开启 thinking |
| 36 | DeepSeek/off | 0（离线统计） | 1 bash | **整轮失败**：运行版本证明成立，但完整正文不是合法 JSON |

### 两个实际模型 worker 的版本证据

第 32 轮只核验了 GLM worker；切模型可能换另一个 warm worker，不能以此证明第 34 轮加载新模块。因此另补新第 36 轮版本核验及不同新题（乘积 90 的互异三数），**没有重放第 34 轮或其他已通过/失败请求**。[新增冻结清单](../artifacts/codebuddy-e2e-20261026/deepseek-freeze-manifest.json)保留原构建，绑定追加后的 runner；原 32–35 runner 另存归档。

两轮真实 bash 均核对以下四个编译 SHA，并从实际工具进程向上定位 worker。所有模块最大编译 mtime 向上整秒为 `1792951813000`，拒绝编译前及同秒旧缓存进程。GLM worker **94399** 出生 `1792952378000`；DeepSeek worker **97558** 出生 `1792953046000`；两者父进程均为编译服务 **88053**。不能把释放 affinity 本身当作新进程证明。

| 编译模块 | SHA-256 |
| --- | --- |
| [codebuddy-cn.js](../app/dist/server/providers/codebuddy-cn.js) | `d359033d1c9aa068c0bd56ac3ee76b77532d86e317491c4cdfd973f933b386ac` |
| [codebuddy-models.js](../app/dist/server/providers/codebuddy-models.js) | `7e96c675b80c186b9ce06958dbacbeb25b54871260afedd0e309eaef1dd40e23` |
| [codebuddy-response.js](../app/dist/server/providers/codebuddy-response.js) | `df3622f333b837c3478b28e205c053bacc5482743073f053bf28f82cb06f4403` |
| [agent-worker.js](../app/dist/server/agent-worker.js) | `801bb5a824b8176bbf6efab62f8e85ab3aa0db0e403fb5f98600b4a67f2c3676` |

### 第 36 轮：版本成立，纯 JSON 契约仍失败

run `9d920d53-9b1e-49d1-a8f1-79cecbc02dc4` 为 DeepSeek/off，业务 completed、无 provider error。真实工具及四 SHA 断言、worker 祖先/出生核验均在 JSON.parse **之前**执行成功；随后 404 字符的正文含不要求的解题前言，整体 JSON 解析失败，suite exit1。后续 JSON 字段及 thinking0 的原断言未执行，不能宣称整轮通过。未裁剪正文、放宽断言或再次请求来覆盖失败。

[只读诊断](../artifacts/codebuddy-e2e-20261026/regression-36-diagnosis.json)独立确认 2 条原生 assistant、1 次 bash、thinking 块字符总数 0、恰好一次 UI prompt，页面/连接/native 读取警告均为空。适配器正常帧不混拼 content/reasoning_content，摘要也不拼接工具前后两条 assistant 的正文；未发现接入层混拼的直接成因。**未捕获真实上游 SSE，不能完全归因供应商，也不能把正文解题前言认定为内部思考泄漏，或将 thinking0 解读为永远可靠关闭。**

第 36 轮失败后，原 suite 内的恢复步骤未执行；已另用真实 UI 选回 GLM/max，未发送 prompt，最新 run 不变、原生会话文件 SHA 不变，无页面/连接错误。[恢复记录](../artifacts/codebuddy-e2e-20261026/ui-selection-restored.json)不算第 37 轮。

最终合计 **36 轮、33 pass、3 fail、35 completed（其中 32 passed-completed）及 1 预设 cancel**；共有 **53 条原生 assistant、19 次工具调用**，最大单次输入 **32,026 tokens**（input + cacheRead + cacheWrite）。第 01 轮没有序列化 run 对象，其完成状态单列由已有原生/UI 证据推断，其余不作此推断。流式长度增长不等于逐帧内容完整渲染；版本哈希和祖先也不是上游内部执行过程证明。

## 6. 官方客户端对比的边界

只读比较 CodeBuddy CLI `2.173.0` 与 WorkBuddy `5.8.3` 的 CLI 文件，没有启动官方客户端、读取其凭据或调用其模型。REA 6.8.0 分析选定派生切片，解析成功不等于全应用语义闭环。

- 官方明确关闭 thinking 的静态分支删除 reasoning 配置；none/off 不在其 effort 归一化白名单中。**这是客户端配置行为，不是 AXIOM 省略请求字段能够可靠关闭的动态证据**；第 31 轮真实反例已限制此前据此保守省略的决策。
- CLI 将 GLM-5.3 列入普通图片 relay 分支（本地图像转 ViewImage 路径提示，ViewImage purpose 再 direct），DeepSeek 不匹配该名单。没有分析 WorkBuddy app.asar 上层，不声称整个 WorkBuddy 应用没有 relay。
- AXIOM 本次附件路径是 UI 上传→scope 文件→read image 工具结果，不是原生 user inline image；两张新图验证这条实际产品路径，不由客户端静态名单推断视觉能力。

[完整本机对照报告](../artifacts/codebuddy-e2e-20261026/rea-compare/investigation-1792948591/REPORT.md)及同目录命令/manifest记录原文件 SHA、UTF-8 半开字节范围及实际退出状态。首批 40/40、后续 58/58 派生切片解析成功；application/semantic 分析仍有 partial/unknown，不是全包或动态出站证明。

## 7. 自动验证及工作树一致性

### 当前补丁

- CodeBuddy 三文件：**22 pass / 0 fail / 0 skip**，约 4.2 秒；[日志](../artifacts/codebuddy-e2e-20261026/unit-off-final.log)。
- 生产构建：`cd app && npm run build`，**exit0**，包含 tsc --noEmit、Vite 与服务端编译；仅大 chunk warning。[成功日志](../artifacts/codebuddy-e2e-20261026/build-off-corrected.log)不覆盖[早先测试类型错误的失败](../artifacts/codebuddy-e2e-20261026/build-off-final.log)。
- 受影响补验：**38 文件、217 pass / 0 fail / 0 skip / 0 cancelled、exit0**，约 215.6 秒；[文件清单](../artifacts/codebuddy-e2e-20261026/affected-test-files.json)与[日志](../artifacts/codebuddy-e2e-20261026/affected-tests.log)。在 app cwd、独立 TMPDIR/TMP/TEMP、test-concurrency=1 下运行，包含 model-service/qoder-protocol 导入者和三个 Qoder 文件；没有重复刚通过且未再修改的 CodeBuddy 三文件。

### 完整四分片（关闭思考修复之前）

命令为 app cwd 的 `tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1` 加各片显式文件列表，临时目录及输出互相隔离，无重试。[清单核验](../artifacts/codebuddy-e2e-20261026/test-manifest-validation.json)确认 **283 文件全覆盖、无重复/遗漏**。

| 分片 | 文件 | pass | fail | skip | 总项 | exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 71 | 461 | 0 | 29 | 490 | 0 |
| 2 | 71 | 449 | 0 | 9 | 458 | 0 |
| 3 | 71 | 497 | 2 | 3 | 502 | 1 |
| 4 | 70 | 402 | 0 | 13 | 415 | 0 |
| **总计** | **283** | **1809** | **2** | **54** | **1865** | **非全绿** |

cancelled=0。skip 涉及平台、原生进程及真实外部 CLI 等前置条件，不能算通过。早先另一条全量命令被工具中止，没有可靠最终退出码，不计入通过证据。不同阶段/版本的专项、补验与全量数字不能简单相加。

两个失败均在[子代理回归测试](../app/tests/subagent-regressions.test.ts)：

1. `real pool resource wait preserves scheduler ownership through recall`
2. `final capacity gate preserves FIFO through 4→1→4 without failed pseudo-runs or spinning`

两者 ID 集合相同但第二、三项顺序交换。[分片 3 日志](../artifacts/codebuddy-e2e-20261026/full-test-shard-3.log)保留原失败；仅一次[隔离诊断](../artifacts/codebuddy-e2e-20261026/fifo-diagnostic.log)匹配的 5 例全部通过，**不覆盖原失败**。scheduler 按 seq 枚举后并发 start、异步环境 prepare 和池按 acquire 到达排序构成候选时序竞态；未稳定动态复现，不宣称根因完全证明。相关调度源码未改，fixture 替换 launchWorker、不走 CodeBuddy 流，未发现直接接入因果。本补丁未扩大修改调度/资源池并发语义，FIFO 风险保留。

全量前后对 1068 个源码/测试文件做 SHA 比对，发现其他会话在运行期间改变了 [model-service.ts](../app/src/server/model-service.ts)、[qoder-protocol.ts](../app/src/server/providers/qoder-protocol.ts)、[qoder-auth.test.ts](../app/tests/qoder-auth.test.ts)、[qoder-runtime.test.ts](../app/tests/qoder-runtime.test.ts)、[qoder-stream.test.ts](../app/tests/qoder-stream.test.ts)。CodeBuddy 三个改动文件当时未变，**但不能声称整个工作树全程冻结**。上述 38 文件补验覆盖这些影响；本任务未覆盖、撤销或混入归因其他会话的改动。

在成功构建之后，第 32–35 轮和第 36 轮各自执行期间都冻结了所测源码、测试、runner 与编译模块。追加第 36 轮只改了 runner，已保留 32–35 原 runner 及旧 manifest，再独立冻结新 runner；没有改产品源码/测试/dist。[最终比对](../artifacts/codebuddy-e2e-20261026/deepseek-final-freeze-validation.json)确认 1068 个源码/测试文件及新冻结模块、runner 均未变化，误写进度文件无残留。本文不把此前全量期间其他会话的修改说成冻结，也不将最新专项/补验说成最新全量全绿。

## 8. 未覆盖范围

未验证百万上下文、真实窗口超限后的自动压缩恢复、全部 11 个目录模型及权限、真实限流/额度耗尽、提前撤销后的刷新重放、新登录完整交互、原生 user inline image/单条多图、完整后台重启、计费准确性及官方客户端实际出站请求。目录初始价格为 0 不代表免费。当前真实结果也不保证所有后续请求、所有模型或内部推理行为相同。
