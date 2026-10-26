# 当前 Axiom CodeBuddy CN 链路静态审计

审计范围：F:/Axiom/axiom2 的 app/src/server/providers/codebuddy*.ts、实际安装的 @earendil-works/pi-ai / pi-agent-core / pi-coding-agent 及 Axiom agent/UI。仅阅读源码及已有测试，不调用真实网络、模型、登录，不读取凭据。未修改生产代码或测试。REA / WorkBuddy 发布包由主代理独立核验，本报告不把 CodeBuddy CN 静态能力等同于 WorkBuddy 产品能力。

## 结论

当前实现是 codebuddy-cn → Pi OpenAI Chat Completions → agent 多轮工具执行 → Axiom 显示投影。文本、可见思考、同模型思考跨工具回放、用户/工具图片、多个工具的交错 JSON 增量及默认并行执行，都有本地源码路径。它们证明客户端可表示/处理这些协议，不证明远端账号或每个模型实际支持。

明确缺口：off 被删除而非发送明确禁用信号；thinkingBudgets 默认不落到请求；模型目录静态且价格未核验；无独立 WorkBuddy provider；路径图片依赖模型读工具；换模型会将旧可见思考降为普通正文；usage 缺失留零；strict JSON 输出不受保证。

## 路径与版本

- `app/src/server/model-runtime.ts:8-10,32-41,73-77` 注册原生 `codebuddy-cn`，名称“CodeBuddy 国内版”；未见名为 WorkBuddy 的专用 provider。
- `app/src/server/providers/codebuddy-cn.ts:34,89-100` lazy import `@earendil-works/pi-ai/api/openai-completions`，stream / streamSimple 共用包装。
- `app/src/server/providers/codebuddy-models.ts:3-14` baseUrl 为 `https://copilot.tencent.com/v2`，固定 CLI/CodeBuddy 2.173.0 指纹；OpenAI SDK 拼出 `/chat/completions`。
- 实际安装 `app/node_modules/@earendil-works/pi-ai/package.json:3` 版本 1.1.0；本文 Pi 行号均指已安装 dist JavaScript，不是上游最新版本。
- `codebuddy-auth.ts:21-29,69-105,107` 是固定 CN origin 的浏览器 OAuth、轮询、刷新、access token → apiKey；只读实现，没有调用认证。

下文缩写：

- **O** = `app/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js`
- **T** = `app/node_modules/@earendil-works/pi-ai/dist/api/transform-messages.js`
- **S** = `app/node_modules/@earendil-works/pi-ai/dist/api/simple-options.js`
- **A** = `app/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`
- **SDK** = `app/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.js`

## 文本与 system / 工具声明

- O:353-395 接受 SSE chunk，仅使用 `choices[0]`；`delta.content` 追加到一个 text block，并发送 text_delta。thinking、tool_calls 是独立 if，可与正文在同一个 chunk 共存，空 tool_calls 数组无副作用。
- O:276-294 为正文与思考各保留一个块，不按每次文本/思考交替新建段落；最后统一结束块（O:467）。因此 UI 不保留精确跨类型时间交错顺序。
- O:583 请求 `stream_options.include_usage=true`；O:600-608 发送函数工具定义，有工具历史但无当前工具时发送空 tools 数组。CodeBuddy 包装保持用户 onPayload 返回内容，仅强制 stream=true 和思考字段策略（codebuddy-cn.ts:68-79）。
- `supportsDeveloperRole:false`，system 使用 system role。默认不支持 mid-conversation system：`dist/utils/transcript.js:58-85,96-103` 将多个 system 的内容/section/tool 状态折叠到开头；并非逐条保留原来的 system 消息位置。约束未被替换成短提示。
- O:475-486 缺 finish_reason 报错；unknown / content_filter / network_error finish_reason 报错（O:1194-1216）。length 与 tool_calls 分别映射 length、toolUse。
- `codebuddy-cn.ts:35-61,81-85` 对非 SSE HTTP 响应及 SSE 顶层非零数字 code 归一化错误；6004→429，11102 模型不可用；HTTP200 业务 JSON 不被当成正常响应。非 SSE 正常 JSON 也不受支持，因为本通道强制 streaming。

## 可见思考、签名及跨工具回放

- O:400-425 优先选择首个非空字符串 `reasoning_content` → `reasoning` → `reasoning_text`，防止同一 chunk 重复拼接。记录首个字段名于 thinkingSignature，发送 thinking_delta。并不证明此文本是完整内部推理。
- O:455-465 支持合法 `reasoning_details` replay 元数据；O:170-175/240 将数组序列化进 thinkingSignature。该字段不直接变成可见思考；仅有 reasoning_details 时 UI 可能没有可读思考文本。专用的 `reasoning_content_signature` 等非通用字段未有 CodeBuddy 特殊适配。
- T:68-89 同 provider + api + model 时保留 thinking 及其签名。O:973-1011 将已识别字段名写回 assistant 原字段；O:1019-1046 同一 assistant 同时携带 tool_calls / reasoning_details。故成功的同模型 assistant(thinking+tools) → toolResult → 下一轮可回放思考，不会因工具调用自动清除。
- A:141-170 将 assistant 与工具结果留在 context；`pi-coding-agent/dist/core/agent-session.js:752-764` 在 message_end 持久化原生消息。Axiom 的显示投影不反写成模型历史。
- 边界：T:74-89 换 model/provider/api 后可见 thinking 转普通 text，redacted thinking 丢弃；并非原字段跨模型回放。T:165 跳过 error/aborted assistant；T:135-146 为缺失工具结果补 `No result provided`。O:1054-1062 会跳过没有正文且没有 tool_calls 的 assistant，即便有纯思考/签名。
- 字段混用时所有思考聚入同一个块，回放使用第一个 thinkingSignature；不能认为多种 reasoning 字段会分别保留。

## 思考开关与预算

- `codebuddy-models.ts:24-55` 全部模型 reasoning:true；off 为可关闭模型映射 `none`，其余 null。模型列表参见下一节。
- `pi-ai/dist/models.js:679-709` null 排除 UI 选项，非法等级向可用等级 clamp；`app/src/server/models.ts:91` 把 getSupportedThinkingLevels 输出给 UI。`agent-worker.ts:831-832` 设置选择并验证有效等级。
- SDK:272,287 → A:273 → O:517-530 使用 streamSimple，effort 由 thinkingLevel 映射。O:714-723 对无 effort 且 off 映射为 none 的模型原本会发 none，但 **codebuddy-cn.ts:71-76 删除 none/off 和 reasoning_summary**。因此“关闭”仅表示不发送显式思考请求，不是已验证的服务端禁用。对于不支持 off 的模型，正常 UI 不提供关闭。
- 开启时 wrapper 添加 `reasoning_summary:"auto"`；返回内容仍由服务端决定。off 不会屏蔽服务端返回的 reasoning。
- O:728、755-766 只有配置 thinkingTokenBudgetField 或 supportsThinkingTokenBudget 才发送预算；默认 O:1289-1290 为 false/undefined，CodeBuddy compat 未覆盖。因此 SDK 从 settings 取得的 thinkingBudgets 不会成为此通道的请求预算。不能把 high/xhigh 等 effort 当成确切 token 数。
- S:5-9,18-23 将 streamSimple maxTokens 默认设为目录 maxTokens，并限制到 `contextWindow - estimatedContext - 4096`，下限1。并非实际 tokenizer 或服务端保证；显式 maxTokens 不额外 clamp 到目录 model.maxTokens。原生 stream API 未经过 buildBaseOptions，max_tokens 依 options 是否提供（O:588-596）。

## 静态模型能力

来源 `codebuddy-models.ts:17-55`，注释承认是 9Router snapshot，部分图片/输出上限参考 CLI 产品默认，不代表账号远程配置；没有模型发现 API。

| ID | 图片声明 | 可选 off | effort | context / maxTokens |
|---|---|---|---|---|
| glm-5.2 | 否 | 是 | high,xhigh | 1000000 / 64000 |
| glm-5.1 | 否 | 否 | minimal,low,medium,high,xhigh | 200000 / 48000 |
| minimax-m3 | 是 | 否 | minimal,low,medium,high,xhigh | 512000 / 524288 |
| hy3 | 是 | 否 | low,high | 192000 / 64000 |
| hy4-preview | 是 | 否 | high | 1000000 / 64000 |
| glm-5.3 | 是 | 是 | low,high,max | 1000000 / 64000 |
| glm-5.3-flash | 是 | 是 | low,high,max | 1000000 / 131072 |
| kimi-k3-1 | 是 | 否 | minimal,low,medium,high,xhigh | 1000000 / 1048576 |
| kimi-k2.8-preview | 是 | 是 | low,high,max | 300000 / 64000 |
| deepseek-v4-pro | 是 | 是 | low,high,xhigh | 1000000 / 128000 |
| deepseek-v4.1-flash | 是 | 是 | low,high,max | 1000000 / 128000 |

其中 maxTokens 大于 contextWindow 的条目会被 streamSimple 上述估算限制压低；目录数字不能直接当作一次请求的可用输出量。

## 图片：内嵌、路径、工具

- 旧式内嵌输入：`images.ts:7-35` 校验 PNG/JPEG/GIF/WebP、base64 与文件头、最多4张/单张5MiB/合计10MiB；`agent-worker.ts:624-631` resize 解码；653 拒绝模型 input 未声明 image；1123-1125 调 session.prompt(... images:nativeImages)。O:922-950 转为 `image_url.url=data:<mime>;base64,<data>`。
- 当前 UI 路径附件：`client/chat/Attachments.tsx:76-99` 粘贴先 files.upload，再加入 draft.attachments；`shared/protocol.ts:205-211` 只追加附件路径映射并指示按需读工具。它不自动成为当轮 image_url。Composer.tsx:65-69 的 unsupported 检查只针对 draft.images；路径图片可以提交给文本模型，但最终不会获得视觉能力。
- `pi-coding-agent/dist/core/tools/read.js:80-106` 识别图片、processImage、返回 text+image（失败时文本原因）。工具图片无上述 legacy imagesInput 4张/10MiB限制保证，使用工具图像处理约束。
- O:1065-1125 保持每个 role:tool 的文字与 tool_call_id；连续工具结果的所有图片收集后，额外生成 role:user + “Attached image(s) from tool result:” + data URL 图片。图片不留在 role:tool 中；多工具图片被合并，额外图片消息自身无逐张 tool_call_id 标记。
- T:19-36 对非视觉模型将 user/tool 图片分别替换为省略占位文本。SDK:161-187 若用户开启 blockImages，也会替换成 “Image reading is disabled.”。图片声明只是客户端门槛，不证明远端接受 MIME、尺寸、总请求体或内容。
- 这是图片输入/理解通道；未实现图片生成模型或 assistant 图片流输出。

## 工具流、多轮、并行、JSON 增量

- O:296-351 使用 index Map + id Map 聚合多个工具；O:427-453 每个 function.arguments 字符串片段追加到各自 partialArgs，再 parseStreamingJson，发送 toolcall_delta；O:250-273 最终解析并剥离 scratch 字段。支持交错多工具片段，而非只处理第一个工具。
- 工具名只填充首次非空值，id 也不是任意片段拼接器；协议需遵守正常 OpenAI index/id/name 语义。
- `pi-ai/dist/utils/json-parse.js:71-112` 先 JSON.parse/修复控制字符与非法转义，再 partial-json，失败返回 {}。这是容错增量解析，final 也复用它；不是严格 JSON 完整性保证。O:1292 默认 strict:false 且 CodeBuddy 未开启，工具定义不发送 strict:true。
- A:141-180 等待 assistant 结束后才执行工具，结果加入历史再开始下一轮；不是模型 arguments 尚未完整时提前执行。length 输出的所有工具调用转错误结果、不执行（A:160-165,332-362），避免截断 JSON 经容错解析后误执行。
- A:492 执行前 validateToolArguments，未知工具/校验错误作为错误结果回给模型。
- `pi-agent-core/dist/agent.js:145` 默认 toolExecution="parallel"；SDK:253-289 未改成 sequential。A:366-373 若任何工具 executionMode 为 sequential 或全局 sequential 则整批顺序；否则 A:409-464 先逐个准备/审批，Promise.all 实际并行，结果按原调用顺序入历史。并行能力受工具/扩展策略约束。
- O 请求未显式设置 parallel_tool_calls，故客户端能接收并执行多个调用，并不证明服务端会生成并行调用。

## UI、显示投影及持久化

- `agent-worker.ts:898,953-986` 消费 message_start/update/end，调用 chatMessage 并发送；980/981 分别跟踪思考与工具首 delta。990-1015 工具进度投影只发送文字，但原生最终 toolResult 仍带图像。
- `transcript.ts:71-77,93-127` 拆正文、思考、图像元数据、格式化 JSON 工具输入；provider 签名不出 IPC/WS，但保留在原生 session。UI 的 JSON 输入显示是解析后的对象，不是原始未闭合 JSON 串。
- `transcript.ts:155-184` 推送预览正文16000字符、思考320、普通工具输入512；保留长度/revision，支持详情读取。`client/chat/Thinking.tsx:11-31` 展开后 MessagePartBody 获取完整思考；不是原生历史被截断到320。
- `transcript.ts:97-98` thinkingActive 依赖最后块类型；O 每类只建一个块，所以混合 text/reasoning 时动画状态未必精确反映最后收到哪种 delta，内容本身仍累加。
- `Message.tsx:106,127-134` 思考、正文和图片分别渲染；`MessageImages.tsx:10-29` 仅订阅图片元数据，打开再 message.image/files.preview 获取字节；`ImagePreview.tsx:43` data URL 本地展示。UI 可预览不代表图片已发送给模型。
- `thinking-display.ts:1-29` 还会将正文开头 <thinking> 标签投影为思考；这是显示处理，不为原生历史建立 reasoning_content 签名。

## Usage、价格与限额

- O:156-166 usage 初始全零；364/372 从 chunk.usage 或 choice.usage 更新。无 usage 时不会估算账单，而是保留零。
- O:1163-1191：input=max(0,prompt_tokens-cacheRead-cacheWrite)，cacheRead 支持 prompt_tokens_details.cached_tokens / prompt_cache_hit_tokens / cached_tokens，cacheWrite 使用 details.cache_write_tokens；output=completion_tokens；reasoning 从 completion_tokens_details.reasoning_tokens 提取，已包括在 output 中，不额外相加。
- totalTokens 从本地分项相加而非信任 raw total_tokens；非标准 usage 单位/位置/缓存语义无 CodeBuddy 特殊适配。
- `codebuddy-models.ts:45-46` 成本全零代表未知单价基线，不能宣称免费；`agent-worker.ts:605-622` 无总 token 时 usage=null，cost<=0 显示 null；`request-usage.ts:7-20` 最新请求无有效输入总量时不复用旧命中率。`context-usage.ts:8-23` 上下文估算用于显示/触发，不改账单。
- HTTP429 / code6004 只报告“频繁或额度不足”，无账号剩余额度查询、速率限制表或购买套餐保证。所有硬件/服务端长度、思考预算、图片尺寸与账号权限仍待实证。

## 既有测试与建议核验

仅阅读，未运行测试或真实网络；不报告任何 test passed。`app/tests/codebuddy-stream.test.ts` 现有 mock-fetch 用例覆盖等级/输出上限（16、54）、text+reasoning_content 同 chunk 与 usage（70）、两个工具交错 arguments/工具结果下一请求（114）、none/off 被省略（138）、业务错误/缺 finish_reason（163）、取消（179）。这些测试不是远端能力证据。

所读 CodeBuddy 专属测试未覆盖：reasoning 字段别名与同模型工具后思考签名回放、用户/工具图片 data URL、换模型思考降级、仅 reasoning_details、thinkingBudgets 无效、实际 agent 工具并行执行/UI 懒加载等完整组合。建议主代理在隔离 mock transport 下补回归核验；优先验证 off 的服务端语义、官方每模型视觉/预算/usage 约定，再决定是否改请求字段或 UI 承诺。不要因本报告直接开启未经服务端证实的兼容开关。