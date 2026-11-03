# Qoder 客户端行为对齐

本页保留以官方 npm `@qoder-ai/qodercli@1.1.78` 起步的[接入审计](qoder-capability-audit.md)及历史验证。**当前修复基准已更新为国内官方 `@qodercn-ai/qoderclicn@1.1.81`**，以下实现表和差异已按当前源码校正；最新逐层验证见[1.1.81 修复报告](qoder-repair-1181.md)及[图片修复边界](qoder-image-repair-1181.md)。目标是对齐 **Axiom 宿主中的 native legacy provider**，不是在 Axiom 中运行 CLI，也不伪造官方账户权限。

## 本轮实现

| 范围 | 实现与边界 |
| --- | --- |
| 模型目录 | `key/model_key`、禁用 `false/0`、视觉和推理能力、可选 effort／关闭能力、默认 effort、上下文档位和默认档、输出上限；公开描述与私有目录配置分离。 |
| 参数 | 最终 wire 的 temperature/top_p/top_k/max_tokens、reasoning_effort、enable_thinking、reasoning_budget_tokens、preserve_thinking、tool_choice；非法采样值不发送。显式输出预算不再由 provider 强制裁到目录值。 |
| 思考 | Pi thinking 等级按目录映射；不虚构 minimal；明确 off → none，缺省保留官方默认；原生预算按官方阈值推导 effort；关闭清理预算，且更新 model_config 和 chat_context。 |
| 上下文 | 可显式选择目录支持的档位；非法档位省略；不自动发送默认 context_length 或抬高收费档。缺失输入／输出上限按官方 fallback 200000／32000，而非原来的 32768／8192。 |
| 功能选择 | 规范化目录 feature/function switches，合法选择及严格默认规则；仅显式传入选择时写 business.feature_switches。发送 fast 功能选择不等于实现独立 fastInference 通道。 |
| 多模态 | 视觉模型用户与工具图先按官方流程上传并原位替换 URL，失败保留 data URL，content/contents 均保留数组；PNG/JPEG/GIF/WebP，3 并发、30 秒、512 已完成 URL 缓存、取消后不缓存。非视觉／不支持格式明确拒绝；不放宽预算或自动重传。真实上传已核验，识图未通过。 |
| 工具与消息 | 保留完整 Axiom system（顶层及 system 消息）、文本、工具定义、并行分片调用及工具错误；支持 legacy function_call 转换；工具参数必须形成合法 JSON 对象，异常流不能被容错解析器变为可执行调用。 |
| 思考回放 | 把签名和完整 reasoning item（含加密内容）保存在 Pi 的 thinkingSignature 中，限定同 provider/API/model 回放；preserve=false 剥离。不是把密文展示为普通文本。 |
| 请求关联 | request_id=chat_record_id，request_set_id 默认相同；Axiom adapter 按账号和宿主 session 映射独立 UUID，不自动发送宿主 ID。原生构造器保留显式 requestSetId/sourceSessionId 等扩展。映射最多 256 项，非跨进程持久化。 |
| 认证 | 正式 client_id、立即首次 poll／默认一秒轮询、PAT token／期限／uid 别名、并发合并兑换、设备刷新期限；非 SSE 按 CLI 使用 machineId fallback，SSE 无真实 UMID 不发该 fallback。 |
| 身份头 | 1.1.81 外层版本、签名 cosyVersion、business.version 同步，实际 arch/platform；不发送 hostname，不读取 CLI 配置或伪造硬件指纹。auth 的 qoder/1.1.81 与 JSON/SSE 的 undici UA 分路径核对；丢弃宿主/model 注入 headers。 |
| 数据政策 | 真实 getDataPolicy：AGREE/NO_RECORD → agree，未知 → disagree；失败保留旧值，初次失败 disagree；不写同意状态。与目录缓存共用五分钟生命周期。 |
| SSE | 裸 JSON 与 envelope、quota／notification、受限裸 finish 计时帧、event=finish 特殊规则、refusal/sensitive、迟到 usage；工具续帧空/null/省略 ID 按 index 保留初始 ID。仍校验结束冲突、结束后内容和工具最终 JSON。10605 归为 modelQueued；业务 406 按 CLI 归为内容安全拒绝，不泄漏原文、不自动重放，普通 HTTP 406 不误判。 |
| 安全边界 | 公共端点白名单／地区隔离／禁重定向仍保留；provider 与 Pi 会话外层都禁自动重放，不通过省略失败历史再请求。目录私密字段不进入可持久化模型描述。 |

## 原生扩展入口

普通 UI thinking 设置和 Pi 的 `temperature/maxTokens/toolChoice/sessionId` 有对应适配。高级参数可通过 SDK 调用选项的 `metadata.qoder`，或有效配置对象中的 `samplingParams.qoder` 传入。下面是 `samplingParams` 对象示例，**不是当前 UI 请求体编辑器可直接粘贴的 JSON**：

```json
{
  "top_p": 0.8,
  "top_k": 40,
  "qoder": {
    "contextWindow": 128000,
    "thinkingBudget": 9000,
    "functionSwitchSelections": { "fast": "false" },
    "generation": { "reasoning": { "preserve": true } }
  }
}
```

这里的模型档位及开关键只是使用示例；**必须以实际账号目录为准**。不能假定每个模型都有 128000 档、fast 开关或 9000 思考预算。`metadata.qoder` 优先于 `samplingParams.qoder`，显式原生调用选项优先于两者。`onPayload` 现在作用于最终原生 JSON，而不是临时 OpenAI 投影；返回替换对象后再编码和签名。

BYOK 仅支持目录已提供的模型／参数或显式 `customModelOverride`；按官方规则生成 custom_model，密钥不写进 model_config 或持久化目录。产品不会绕过 BYOK 权限，也不主动调用自定义 URL；下游是否支持、如何转发，由供应商和合法配置决定。不要把密钥放入公开模型名称或通用日志。

## 有意保留的差异与未完成验证

1. **真实验证仅部分完成**：国内站已有 OAuth 通过正常账号路由完成独立 SDK 文本、UI 首轮文本及真实 WS-worker 同会话文本／上下文两轮；当时受控工具两次 10605，未产生工具结果，不推广为当前所有请求状态。图片上传补丁已部署，正常账号编译产品 1PUT/0推理及 URL 字节检查通过，但 CLI 和原生的准确图片基线未通过，URL 推理实验为业务 406。真实 worker 工具图续轮、国际站、计费、PAT／到期 refresh 及长期稳定性未验；不能由离线通过推断生产可用。
2. **签名实现并非已证实的 WASM 等价替代**：保留既有 MIT 参考实现，外层头和签名 payload 内部 `cosyVersion` 已同步 1.1.81；同账号真实服务接受当前文本请求不等于全部密码学语义逐字节等价。未伪造 UMID，不发 hostname，也未补 CLI traceparent／HTTPDNS。
3. **路由／凭据边界**：暂不启用企业/VPC、服务账号、新 model-server HTTP/gRPC、独立 security/fastInference 通道；也不放宽白名单或凭据投递范围。发送显式 fast 功能选择不等于具备独立 fast 路由。
4. **重放与队列**：官方明确鉴权拒绝可刷新后重试，10605 则查询 queue、等待就绪、保持 request_set_id 并更换 request_id/chat_record_id 恢复；本接入 provider 及 Pi 外层均不自动重放。尚无 CLI 的显式队列恢复、排队集合 ask/finish、business/finish 生命周期，不能把缺这些辅助路径断言为实际 10605 的唯一原因。PAT 重新兑换与 OAuth refresh 仍分别实现。
5. **终态 keepalive**：官方 legacy 读取到裸 `[DONE]` 或 EOF，并验证后续帧。本实现继续验证已收到帧，finish+最终 usage 后如无未完成帧，空闲一秒才本地结束，防止网关无限保活。可在底层 SSE 适配器设 `finishIdleMs: Infinity` 使用严格行为。结束一秒之后才到达的服务端错误无法观测，需在线验证最终帧顺序。
6. **附件与宿主职责**：不复制 CLI 自带 PDF 转换、文件搜索、权限规则、worktree、hooks、MCP 和会话文件；由 Axiom 的 agent／工具／会话层承担。Pi 的图片输入仍是 base64，不额外开放任意远程图片 URL；只有 provider 内部受控上传会产生 URL，产品不主动下载该 URL。对不支持图片的处理是明确报错，而非官方的占位文本，避免用户误以为模型已看到附件。
7. **多 reasoning item**：会话保存有序私有回放条目，legacy wire 仍按官方 Nzl 的单个 reasoning_item 结构投影；不伪称支持新 Responses 管道的所有块事件。纯 PAT 的稳定机器身份尚未跨进程持久化。
8. 费用 0 仅表示未知；没有复制官方目录中的信用点倍率为 token 单价。目录 UI 已展示文本／图片、思考等级与单个上下文值，并在添加配置时继承输入能力和思考等级；完整上下文档位、默认 effort、预算、功能开关和输出上限尚未接成专用展示／配置。当前通用请求体编辑器仅支持文本和数字值，不解析 JSON 对象或布尔值；把 `qoder` 对象粘成文本会被底层忽略。高级对象入口目前限 SDK／有效配置对象，不能视为 UI 已兼容。

## 历史证据与验证

下列 1.1.78、51/51 和未重启结论仅描述早期轮次；部分旧 review-artifacts 测试／构建日志现已缺失，链接只保留当时来源，不计入本次可复核证据。前轮 1.1.81 wire 测试、50/50、19/19 及受控工具门禁见[修复报告](qoder-repair-1181.md)；最新图片补丁 50 旧项＋9 新项分轮覆盖、构建、服务加载和未通过的识图边界见[图片报告](qoder-image-repair-1181.md)。

- 官方 tarball integrity 和离线 CLI help/version/model-list 探针见[审计报告](qoder-capability-audit.md)。CLI 的 `--list-models` 因未登录退出 1，这不是线上能力验收。
- 本轮只读原函数摘录及精确偏移/hash：[provenance.json](../review-artifacts/qoder-client-parity/focused/provenance.json)。没有执行这些研究片段，也没有把官方 bundle/WASM 复制进产品。
- REA 本轮 focused 目录分析 53/53 文件解析，0 parse failures，4496 AST nodes、930 semantic unknown；[摘要](../review-artifacts/qoder-client-parity/rea-summary.json)。这是有限范围静态证据，不是全量客户端覆盖率。
- 最终离线回归 **51/51 通过，退出 0**，覆盖 Qoder 四文件、CodeBuddy 三文件及通用 model-runtime；[完整测试日志](../review-artifacts/qoder-client-parity/tests-final.log)。其中 Qoder 本身 27 项全部通过。
- 最终 `npx --offline tsc --noEmit --pretty false` **退出 0**；[类型检查日志](../review-artifacts/qoder-client-parity/typecheck-final.log)。首轮新增测试的两处类型错误已修复，未用跳过类型检查绕过。
- `npm run build`（tsc + Vite + server tsc）**退出 0**；[生产构建日志](../review-artifacts/qoder-client-parity/build-final.log)。有两个大 chunk 的非阻断警告；未启动、部署或重启服务。
- 53 个 focused 片段与原始 bundle 的精确切片、SHA-256 和 UTF-8 字节偏移均复核一致；文档本地链接存在性校验通过。

核心源码：[目录能力](../app/src/server/providers/qoder-catalog.ts)、[原生请求与回放](../app/src/server/providers/qoder-client.ts)、[provider](../app/src/server/providers/qoder.ts)、[认证](../app/src/server/providers/qoder-auth.ts)、[SSE](../app/src/server/providers/qoder-sse.ts)。

## 后续真实调用与辅助事件修正

用户授权后，通过 **Axiom 界面**新建独立测试会话，以 Qoder 国内版 GLM-5.3、`high` 档询问17×19。界面先显示正确答案323，随后仍报“Qoder 事件流缺少 choices”，整次回复失败。这证明此前的离线通过不能代表线上流完整可用，也不能据此证明服务端采用了所选思考强度。见[真实基线](../review-artifacts/qoder-sse-failure/live-baseline.json)。

对官方 `fRe/K2/LEA` 的追加静态核查确认：无 choices 的辅助事件及包装内控制标记并不都应报错。源码现已兼容空对象、受限元数据、包装内空白/quota/notification；仍拒绝未知内容结构、错误 choices 类型、业务错误及没有 choice 结束状态的截断流。新增测试还覆盖工具参数分片之间的辅助事件。更新后的8文件离线回归 **53/53、退出0**，[最终日志](../review-artifacts/qoder-sse-failure/tests-final.log)；[类型检查](../review-artifacts/qoder-sse-failure/typecheck-final.log)和[隔离服务端编译](../review-artifacts/qoder-sse-failure/server-build-final.log)均退出0、无诊断，后者只生成到调查目录，不覆盖运行产物。

用户随后明确授权应用补丁。现已备份并原子更新运行版 `qoder-sse.js` 和 source map，**没有重启服务或终止旧会话 worker**；[部署记录](../review-artifacts/qoder-sse-failure/deployment/applied-diagnostic.json)。旧会话已缓存模块不会自动热更新，新独立会话加载新模块。

两次修复后 Axiom 真实复验均未成功。补充固定枚举脱敏诊断后的第二次已确认：外层响应 **HTTP 200**，流内普通 `message` 包装的状态为 **403**，JSON 正文业务码也是 **403**；没有答案输出。[第二次实测](../review-artifacts/qoder-sse-failure/live-postpatch-attempt-2.json)及[Axiom 响应阶段记录](../review-artifacts/qoder-sse-failure/live-postpatch-latency-2.json)。诊断后缀证明新解析器确已执行，不是仅替换磁盘文件后误测旧缓存。

最新诊断版的受影响 Qoder 四文件 **29/29 通过**，[日志](../review-artifacts/qoder-sse-failure/tests-diagnostic-final.log)；[类型检查](../review-artifacts/qoder-sse-failure/typecheck-diagnostic-final.log)和[隔离编译](../review-artifacts/qoder-sse-failure/server-build-diagnostic-final.log)均退出0。其余不依赖 Qoder 的24项此前通过，未重复运行。

**以上为早期失败记录，不是当前最终状态。** 后续 1.1.81 修复捕获并兼容了裸 finish 计时帧，独立 SDK 和真实 UI 首轮均通过；还定位并修复工具续帧空 ID 误判。该受控真实同会话 T1/T2 通过，但当时工具请求连续遇到 10605，未命中修后执行路径；这不是当前所有工具请求的结论。完整门禁仍未通过，后续图片上传与识别边界见[图片报告](qoder-image-repair-1181.md)。403 不能作为辅助帧吞掉，也不能仅凭状态推断令牌过期或思考档位已采用。历史边界见[调查说明](../review-artifacts/qoder-sse-failure/notes.md)，最新证据和限制见[1.1.81 报告](qoder-repair-1181.md)。
