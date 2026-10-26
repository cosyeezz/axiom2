# WorkBuddy / CodeBuddy 能力审计

## 结论与验收状态

**当前实现具备文本、可见思考、图片输入与工具调用的主要客户端协议通路，但不能认定为“WorkBuddy 所有模型全部能力已完整验收”。**

已完成当前源码、实际 WorkBuddy 发布产物、9router 两个版本的对照，以及 19 项隔离测试。真实目标模型调用仍阻塞：用户授权通过 Axiom 实测，但当前运行的 Axiom 未返回 CodeBuddy / WorkBuddy 可用模型。本报告不把 mock、静态能力声明或其他供应商同名模型当成上游成功证据。

未修改生产接入代码、现有测试，未显式保存模型配置或凭据；仅新增审计文件与补充 mock 测试。没有启动官方 CLI，没有直接请求腾讯模型，没有使用 Bash 调用模型。后续源码复核发现 `configuration.get` 默认可能执行既有内嵌密钥归一化迁移；未检查凭据原文，因此不宣称该 RPC 在所有配置下绝无持久化副作用。后续状态探测应优先仅订阅 configuration snapshot。

| 能力 | 当前实现与隔离验证 | 真实账号验收 |
|---|---|---|
| 文本 / 系统约束 | 支持 SSE 文本与 usage；不采用 9router 替换 system 的策略 | 待目标模型可用 |
| 可见思考 | 支持 reasoning_content / reasoning / reasoning_text；同模型跨工具轮次回放已 mock 验证 | 思考内容是否返回、各 effort 是否生效待测 |
| 关闭思考 | none/off 被删除，只表示不显式请求；上游若仍返回思考会正常显示 | **不能保证真正关闭** |
| 精确思考预算 | 当前 compat 不生成预算字段；high/xhigh/max 不是 token 数 | **未对齐官方 CLI 可携带预算的机制** |
| 用户图片 | 视觉模型发送 data URL；文本模型剔除历史图片字节，已 mock 验证 | 实际视觉识别待测 |
| 工具图片 | role:tool 保留文字，图像移动到后续 user 消息，已 mock 验证 | read 图片 → 模型识别的完整循环待测 |
| 非视觉模型看图兜底 | 未发现官方新版 ViewImage → 视觉代理的等价接入 | **缺失，不应宣称任意模型都能看图** |
| 工具调用 | 多工具 JSON 分片、结果回传已有 mock；agent 有实际执行与条件并行机制 | 模型选工具、执行、消费结果待测 |
| 图片生成 / 图片输出 | 当前 CodeBuddy provider 没有 image-generation API 或 assistant 图片流实现 | **不支持这一独立能力** |
| 动态模型能力 / 账号权限 | 使用静态 11 模型目录；无账号实时能力发现 | 未验收，不能保证全部 ID 可用 |

“思考”指接口返回的可见思考/摘要，不代表模型全部内部推理过程。图片输入、工具返回图片和图片生成是不同能力。

## 1. 三方身份与传输

### Axiom

- 实际 provider 为 `codebuddy-cn`，名称“CodeBuddy 国内版”，不是独立 WorkBuddy provider。
- `app/src/server/providers/codebuddy-models.ts:3-14`：`https://copilot.tencent.com/v2`，指纹 CLI / CodeBuddy 2.173.0。
- `codebuddy-cn.ts:34,89-100`：复用已安装 Pi AI 1.1.0 的 OpenAI Chat Completions 通路，最终 `/chat/completions`，强制 SSE。
- 当前文档早已声明未验证 WorkBuddy 账号和额度互通；不能仅以入口名称判断后台是否相同。

### 本机实际 WorkBuddy

- 安装路径 `C:/Program Files/WorkBuddy`，桌面包版本 **5.3.14**。
- `resources/app.asar`：283,047,928 字节；外层 package 名 `@genie/workbuddy-desktop`。
- 内置 CLI：`resources/app.asar.unpacked/cli/dist/codebuddy.js`，22,490,463 字节。
- CLI SHA-256：`4ae61608d1020ccfd9ead9f7c3364337c273077545db6750218dd98ef1a723f9`。
- CLI package 顶层 `@genie/agent-cli@0.0.0`，其随包嵌入元数据标记 `@tencent-ai/codebuddy-code@2.115.0`；不是将 npm 最新版本冒充本机 CLI。
- 随包 `product.internal.json` 同样指向 `https://copilot.tencent.com`。
- 桌面 `main/cli-product-env.js` 支持 `ACC_PRODUCT_CONFIG_V3` / `ACC_PRODUCT_CONFIG_PATH` 注入产品配置；因此静态默认 endpoint 不等于本机运行最终 endpoint，更不证明登录和套餐必然互通。
- 提取的 ModelProvider 使用产品 endpoint + `/v2`，创建 `OpenAIChatCompletionsModel`；按配置/环境允许自定义模型 URL，附加会话与客户端标识。该默认请求协议与 Axiom 一致，但遥测、产品配置和 agent 外壳不等价。

### npm 当前官方 CLI 补充对照

另下载而未安装/执行 `@tencent-ai/codebuddy-code@2.176.0`，归档 62,540,407 字节，SHA-512 与 registry `dist.integrity` 完全匹配。它用来核对当前产品默认与较新机制，不代替本机 WorkBuddy 身份。

- 当前匹配 ID 中 GLM-5.1 / GLM-5.2 明确 `supportsImages:false`；Axiom 的保守门禁与此一致。较老本机 WorkBuddy 配置曾将 GLM-5.1 声明为有图，证明能力表会随版本改变。
- GLM-5.3、GLM-5.3-Flash、Kimi-K2.8、DeepSeek-V4-Pro / V4.1-Flash 的当前随包配置声明有图和工具。
- 最新配置有 `minimax-m3-pay`、`kimi-k3-2`；Axiom / 9router 中为 `minimax-m3`、`kimi-k3-1`。不据此断言旧 ID 下架，也不自动替换成付费变体。

### 9router

- 仓库 [decolua/9router](https://github.com/decolua/9router)，查询时 31,392 stars；星数不是能力证据。
- HEAD `f39d8f07481ae8518e93175f0ecaaafa61573c6c`，v0.5.109。
- Axiom 引用快照 `87a74e1bda3677193c6f71a7e2100c90311f0689`，v0.5.104。
- 两版仅发现 `codebuddy-cn` 与 `codebuddy-intl`，未发现独立 WorkBuddy provider；不能据此推断腾讯产品没有后台复用。
- 两版 CodeBuddy 专用 registry、executor、OAuth 文件无差异。HEAD 的共享层增加工具 ID 修补与 reasoning 别名规范化，不是新增 WorkBuddy 能力。

## 2. 文本、思考与工具回放

Axiom 的已安装 `@earendil-works/pi-ai/dist/api/openai-completions.js`：

- `383-425` 分别接收正文与三种思考字段；相同 chunk 可以同时有 text、thinking、tool_calls。
- `973-1046` 同模型将思考按原字段名回放，并保留工具调用；补充测试验证三种字段均可跨工具结果继续请求。
- 换 provider / model / api 时，Pi 将可见思考转成普通 assistant 文本，不承诺跨模型原始签名无损回放。
- `296-453` 按 index / id 聚合多个工具及参数片段；agent 等 assistant 结束后才执行。全局默认并行，但包含 sequential 工具时整批顺序；请求未显式要求 `parallel_tool_calls`。
- 参数最终也使用容错 JSON 解析，不是严格 JSON 输出保证；agent 校验参数，length 截断的工具不执行。工具结果与 assistant 消息进入原生历史，UI 投影不重写模型历史。
- UI 的思考预览截断不代表原生历史被截断；可展开读取完整可见思考。

9router CN 会将超过 2000 字符或命中 agent 身份模式的 system 替换为中性提示。Axiom 明确保留系统提示和工具约束，这对完整保留用户约束更合适，但上游是否拒绝某些提示仍需账号实测。不能为了“兼容”静默照搬提示替换策略。

## 3. 思考开关和预算不等价

- Axiom `thinkingLevelMap.off` 可映射 `none`，但 `codebuddy-cn.ts:71-76` 删除 `none/off` 与 summary；9router executor 也有相近的删除策略。两者都不能仅从 UI 开关推出服务端真正关闭。
- 补充 mock 特意在 off 请求后返回 reasoning，结果仍显示该思考；这是当前行为，不是生产上游实测。
- Axiom 的 CodeBuddy compat 未开启 `supportsThinkingTokenBudget` / 预算字段，所以传入 `thinkingBudgets` 也不产生 `max_thinking_tokens`。
- 实际 WorkBuddy CLI 模块 66545 的 `configureThinkingSettings` 可从 `MAX_THINKING_TOKENS` 建立 providerData.max_thinking_tokens；npm 2.176.0 还能读取会话级 maxThinkingTokens。它证明官方客户端能构造该预算，不证明所有账号、模型或 endpoint 都接受它。
- 较新 CLI 根据产品能力限制 effort；Axiom 部分模型的 effort 仍来自 9router 默认。需要按实际返回逐模型验收，而非任意补开预算开关。

## 4. 图片的关键区别

- Axiom GLM-5.2 / 5.1 声明仅文本，其他九个目录模型声明可接收图。9router CN 则对 11 个全部 vision=true；后者不能作为逐模型实证，Axiom 不宜盲目放开。
- 内嵌用户图转换为 `image_url.url=data:<mime>;base64,...`。
- **当前 UI 的路径图片附件只加入路径映射，不自动变成同轮图像 payload。** 模型需要调用 `read` 工具取得图片。能预览附件不等于模型已看到图片。
- 工具结果中的图片与 tool role 分离，追加到后续 user 消息；补充 mock 验证了该序列化，未验证实际视觉理解。
- 非视觉模型的图像历史会被替换为省略占位；单纯 read 不能把文本模型变成视觉模型。
- 新版 CLI 有 `direct / relay / omit` 图像投影及 `ViewImage` 路径提示；产品配置定义 `viewImageDescriber` 使用 `glm-5.3-flash` 给非多模态主模型提供视觉代理。Axiom 当前没有等价自动路由。此为**新版官方 CLI 补充对照**，不把它误称为已在本机旧版本运行验证。
- 当前 CodeBuddy provider 没有图片生成操作。WorkBuddy 的附加多模态技能/工具也不能直接算作聊天模型原生输出能力。

## 5. 验证与真实调用阻塞

### 隔离测试：19 项通过

1. 既有三个 CodeBuddy 文件：15/15，exit 0。
   - 工作目录 `F:/Axiom/axiom2/app`。
   - `node_modules/.bin/tsx.cmd --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/codebuddy-auth.test.ts tests/codebuddy-stream.test.ts tests/codebuddy-runtime.test.ts`。
   - worker 登录 fixture 禁止 socket；使用虚构 token，不使用真实凭据。
2. 新增审计测试：4/4，exit 0。
   - 工作目录 `F:/Axiom/axiom2`。
   - `app/node_modules/.bin/tsx.cmd --test review-artifacts/workbuddy-audit/offline-capabilities.test.ts`。
   - 覆盖用户图/文本门禁、三种思考字段跨工具回放、工具图移位、off 与预算实际出站、缺失/错误 finish。
   - 全部注入 mock fetch；不等于通过 Axiom 的真实模型调用。

### Axiom 实例只读检查

通过运行中的 Axiom `/ws`（同源 Origin）执行 `configuration.get` 与 `subscribe(configuration)`，未直接读取凭据文件，也未显式调用配置写入接口（该读取 RPC 的内置迁移边界见开头说明）：

- **4317 主实例**：dataRoot `C:/Users/dane/AppData/Roaming/Axiom2`；5 个 provider、15 个可用模型，没有 `codebuddy-cn` / WorkBuddy。
- **4327 预览实例**：`C:/Users/dane/AppData/Local/Axiom2-index-preview`，无可用模型。
- 4177 不提供相同 Axiom WS 路由，返回 404。

用户随后确认目标为 4317。再次检查时主实例可用模型增加为 22 个，仍只有原 5 个 provider，没有 `codebuddy-cn` / WorkBuddy；配置菜单已提供 `CodeBuddy 国内版` 模板，支持 OAuth 和 API key。因此不是缺少添加入口，但仍需在该实例保存/登录目标供应商。补充的只读证据见 `review-artifacts/workbuddy-audit/axiom-main-status.json`，检查时间 2026-10-25T15:31:43.764Z。此前 15 模型是首轮检查历史值，不能当作最新数量。用户回复“继续”后于 2026-10-25T15:36:52.750Z 再检，配置 revision 与 5 provider / 22 可用模型状态均未变，目标条目仍缺失；未发起真实目标模型调用。

因此没有创建目标模型实测会话或消耗其额度；未以 Qoder 的同名 GLM 模型冒充目标模型。需要用户在主 Axiom 保存/登录目标供应商，或提供实际配置所在实例端口。恢复后只走 Axiom 的专用审计会话 `agent.model` + `prompt`，不走 Bash / CLI / 直接上游请求；不改原会话与默认模型。

### 后续配置差异排查

用户确认已登录保存后，再检发现 4317 配置确实发生变化，而非服务端始终返回旧状态。2026-10-25T15:39:52Z 至 15:41:10Z，`qoder-cn` 从未认证变为已认证，配置目录变为 4 个 provider，可用模型总数 17；Qoder 当前为 `qmodel_38max`（Qwen3.8-Max）和 `dfmodel`（DeepSeek-Flash）。`codebuddy-cn` 仍未出现。这说明不能再笼统称“用户没有保存”；需要确认用户是否实际希望测试 Qoder，而非本报告原定的腾讯 CodeBuddy / WorkBuddy。

本机 4317 各监听地址均属同一服务进程；前端使用同源 `/ws`。只读查看登录页来源也对应 `qoder.com.cn`。未获取用户模型设置截图，未读取密码或凭据，未代为修改配置。当前 CodeBuddy 的真实验收仍未执行，亦未擅自改测 Qoder。

另已核对配置可见性源码：供应商列表合并所有已保存凭据 ID；认证失败或模型目录为空不会直接隐藏供应商。因此“只有模型列表被过滤”不足以解释 `configuration.get.providers` 中也没有 CodeBuddy。OAuth completed 的主进程条件包含持久化确认。现有证据说明 Qoder 登录更新可见，但不足以确认用户期望的目标是否就是 Qoder，需明确目标而非反复要求重新登录。

待执行的最小真实验收：

1. 精确文本回显和短推理任务，核对完整终止与思考事件。
2. 使用内容未写入提示的测试图读取颜色/形状/随机标记，验证原生图像输入及 read 工具图片回传。
3. 读取仅存在审计目录的随机文件标记，确认 tool call → 实际执行 → toolResult → 正文使用结果；必要时双工具测试。
4. 同模型连续工具回合与思考 off/high 对照；按服务端事件记录，不靠自述判定支持。

一两个模型通过不能宣称所有 11 个都通过；应记录具体 provider、ID、effort、时间与失败响应。计费和产品权限另行核实。

## 6. REA 证据与可复核文件

全部工作文件在 `review-artifacts/workbuddy-audit/`，非用户凭据目录。

- `asar-inventory.json`、`workbuddy-asar/`：只读清单和提取的桌面产品配置代码。
- `installed/module-ranges.json`：原始 bundle SHA、数字模块 ID、UTF-16 起止位置与片段 SHA。提取模块外加 `({ ... });` 只用于静态解析；不执行模块。
- `readable/`：TypeScript printer 阅读副本，行号仅对应该副本，原字节证据以 ranges 为准。
- REA 首次分析四个切片，4 个解析成功 / 11,858 AST 节点 / 0 parse failures，summary `rea-installed-summary.json`。中途 REA 服务重启，随后尝试导出的 `rea-evidence-bundle.json` 为 **0 records**，不作为完整分析证据。
- 为核验预算、图像过滤和 ACP 显示，扩大为模块 66545 / 12502 / 46307 的三切片分析：3 个解析成功 / 56,758 AST 节点 / 0 parse failures；父证据 `ev_1b7a6665faf438fb18bcabb275fc28dd22d661ad9e0d48af61ef5f9e18126359`。`rea-core-summary.json` 与 `rea-core-bundle.json`（31,112,010 字节，2 条 Evidence）已保存。
- REA application / semantic coverage 都是 **partial**，容量限制保留了未知项。解析成功不等于恢复完整调用图；静态关系不证明运行可达、账号互通或远端能力。关键结论另经原模块阅读核对。
- `npm-integrity.json`、`codebuddy-npm-metadata.json`：npm 当前包来源和完整性。
- `9router/audit-report-20261025T1502.md`：两版路径、行号、能力矩阵与差异。
- `current-chain.md`：Axiom / Pi / agent / UI 完整静态链路及边界。
- `current-tests.txt`、`offline-capabilities.log`：本次测试日志。
- `axiom-services.json`：Axiom 可用目录快照，不含访问令牌或刷新令牌。

下一步优先解决真实调用入口，再决定是否修正动态目录、思考关闭承诺、预算适配和非视觉图片代理；不以 9router 的默认声明代替实证后直接扩大能力。
