# Qoder 接入能力审计

> 这是实施前的审计快照，保留原始发现与证据。后续已修改产品代码，当前实现与剩余差异请看[客户端行为对齐](qoder-client-parity.md)和[接入说明](qoder.md)；下文“当前接入”均指审计时版本。

## 结论

**当前接入不是完整的 Qoder CLI 功能移植，而是 Qoder 原生协议的文本／工具调用 provider 子集。模型控制能力确有缺口，不能把“账号目录可见”“能解析思考输出”和“模型能力完整可控”视为同一件事。**

本次只调查与运行隔离验证，没有修改产品代码、正式配置、账号或凭据。对照对象为当前工作区实现和本次 npm registry `latest` 返回的官方 `@qoder-ai/qodercli@1.1.78`。没有获取用户真实账号的模型清单，不能据此列出该账号实际可用的具体模型、额度或长上下文权益。

## 能力对照

| 能力 | 官方 CLI／发布物证据 | Axiom 当前接入 | 判断 |
| --- | --- | --- | --- |
| 账号模型目录、按 key 选模型 | `--list-models`、`--model`；目录携带能力与配置 | 签名拉取动态目录；没有所选 key 就报错，不回退 | 核心路径已有；真实账号未验收 |
| 模型思考能力描述 | `is_reasoning`、`efforts`、`supports_disabled`、默认 effort | 所有模型固定 `reasoning:false`，兼容项关闭 reasoning effort | **未完整映射** |
| 思考开关、强度、预算 | `--reasoning-effort`、`--thinking`、`--thinking-budget`；请求构造器设置对应字段 | 不映射这些控制；只复制目录 `is_reasoning` | **明显缺口**，off／none 不保证关闭 |
| 思考内容输出 | 官方消息结构包含 reasoning | 可解析 SSE `reasoning_content` 为 thinking block | 输出解析已有，不等于可调强度 |
| 上下文能力与档位 | `--context-window`；可用 windows／默认 window／`context_config` | 直接把 `max_input_tokens` 作为本地窗口，不映射档位、默认档位与 `parameters.context_length` | **部分支持** |
| 最大输出量 | `--max-output-tokens`、目录 `max_output_tokens` | 读取目录上限并裁剪请求 `max_tokens`，缺失回退 8192 | 已有本地映射；真实服务上限未验收 |
| 图片／其他附件 | `--attachment`；发布 README 声明图片、PDF；消息处理有 vision 分支 | 只声明 text；图片／非文本内容明确拒绝，即使目录 `is_vl:true` | **多模态未接入**；不代表所有 CLI 模型均支持所有附件 |
| system／工具／多轮历史 | 发布物请求构造器传递 messages、tools、system | 已实现文本历史、工具定义、并行分片工具调用和工具结果 | 离线契约已验证 |
| tool choice／通用生成参数 | 官方构造器显式设置 `tool_choice` | 最终 parameters 仅保留 max_tokens；temperature／top_p／tool_choice 等丢弃 | **参数存在静默失效**；采样参数是否上游接受还需逐项核验 |
| 认证 | 浏览器设备登录、PAT | 双地区 PKCE／PAT 兑换、用户身份、刷新和地区隔离 | 已实现，在线认证与续期未验收 |
| BYOK／自定义模型／企业能力 | 官方请求构造器支持 custom_model；目录有扩展能力 | 过滤外部 provider、非 system、custom adapter；只接受地区公共端点 | 明确缩小了支持范围，不应盲目透传私密配置 |
| 官方会话与代理功能 | continue／resume／remote、MCP、skills、hooks、agents 等 CLI 入口 | 当前 provider 不是 CLI 代理，不操作官方会话管理；执行使用 Axiom 自己的工具／会话体系 | 产品层差异，不等于 Axiom 没有工具、MCP 或续聊 |
| 价格／计费 | 发布物有 price_factor 等元数据 | token 成本四项均为 0，尚无真实价格映射 | 0 表示未知，**不能解释为免费**；倍率也不能直接当 token 单价 |

Axiom 代码定位：[模型描述与请求映射](../app/src/server/providers/qoder.ts#L10)、[目录过滤](../app/src/server/providers/qoder.ts#L65)、[认证](../app/src/server/providers/qoder-auth.ts)、[公共端点约束](../app/src/server/providers/qoder-protocol.ts#L69)。既有范围和未验收项见 [Qoder 接入说明](qoder.md)。

## 已复现的具体问题

### 1. 思考控制及其他参数在最后一次转换中丢失

新增的 [隔离探针](../review-artifacts/qoder-audit-20260817/control-probe.mjs) 使用虚构目录与 mock fetch，禁止真实 socket，运行退出码为 0。为了单独验证最终转换，探针通过 `onPayload` 显式注入控制字段，不把它描述为所有 UI 选项均已可选。

中间 OpenAI payload 分别设置：

- `reasoning_effort: high / none`、`enable_thinking: true / false`；
- 思考预算 4096、上下文 128000、`tool_choice: required`；
- temperature 0.25、top_p 0.8、最大输出 300。

**两个最终 Qoder 请求都只剩 `parameters: {max_tokens:300}`，而 `model_config.is_reasoning` 都为 true。** 这直接证明最终转换丢弃控制参数；不证明真实服务端会怎样生成。

官方原始 `zVe` 函数相反：设置 `reasoning_effort`／`enable_thinking`／`reasoning_budget_tokens`，none 分支会关闭 `model_config.is_reasoning`；合法窗口写入 `context_length`，显式 tool choice 写入 `tool_choice`。静态原文及源偏移见 [官方函数摘录](../review-artifacts/qoder-audit-20260817/official-excerpts.md#zve)。探针完整结果见 [control-probe.json](../review-artifacts/qoder-audit-20260817/control-probe.json)。

### 2. 上下文描述忽略账号默认档位

同一 mock 目录提供 `max_input_tokens:200000`、默认窗口 128000、可选窗口 128000／200000。当前本地描述为 200000，但请求不发送上下文档位。它不能证明已获得或实际启用 200000，也可能导致本地预算和服务端默认档位不同。

缺字段时 32768／8192 是接入自己的回退值，不是已经验证的模型固有限制。本轮没有确认官方字段在服务端如何计算输入输出总预算。

### 3. 数值型禁用状态过滤不完整

当前过滤仅检查 `enable === false`。探针加入 `enable:0` 的目录项，该模型仍出现在本地列表；官方发布物的多处标准化实现同时排除 false 和 0（[原文片段与源偏移](../review-artifacts/qoder-audit-20260817/official-enable-excerpts.json)）。这是有条件的兼容性问题，**未观察到用户真实目录包含这种值**。

## 验证与 REA 证据边界

- 官方包：`npm pack --ignore-scripts` 下载到隔离目录，没有全局安装或执行 postinstall。压缩包 SHA-512 与 npm integrity 一致；[下载记录](../review-artifacts/qoder-audit-20260817/npm-pack.json)。主 bundle SHA-256：`ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38`。
- CLI 实际执行：独立配置与空工作区，预加载脚本阻断网络／fetch／子进程。`--help` exit 0，[输出](../review-artifacts/qoder-audit-20260817/cli-help.txt)；`--version` exit 0 为 1.1.78；`--list-models` exit 1，明确 `Not logged in`，[记录](../review-artifacts/qoder-audit-20260817/cli-probes.json)。没有调用 login 或在线聊天。
- 原有 Qoder auth／stream／runtime 三文件测试 **16/16 通过，exit 0**。包括模拟认证、目录、system／工具、思考输出、流式取消／错误与恢复等；[UTF-8 日志](../review-artifacts/qoder-audit-20260817/tests-utf8.log)。没有修改这些测试或 provider 源码，没有重跑无关构建。
- REA 全 bundle 分析在 MCP 60 秒期限被取消，追回的父 Evidence 为 `ev_ef28350f370f7a2207ce461aa7a48ae520f6b4277f069cf042b8893212e23546`。该轮 parsed 0／skipped 1，**不能作为全量逆向完成的证明**。
- 为解决文件过大，使用 TypeScript AST 从同一 bundle 精确提取 11 个函数，不执行它们；[provenance.json](../review-artifacts/qoder-audit-20260817/focused/provenance.json) 保留原始 hash、字节／UTF-16 范围与摘录 hash。REA 摘录分析父 Evidence：`ev_a05236d3d4ed232105bece67d9c440941c0b4d743603b9d930d38a64dbb6c827`；成功解析 11/11，无 parse failure。静态源模块视图：`ev_0f3a3930d7be3832c8a3712193171dea3b2c6f6fe62a416ed44f5151069dda10`。
- [REA 摘录摘要](../review-artifacts/qoder-audit-20260817/rea-focused-summary.json) 仍报告 382 个语义 unknown：完整性仅限摘录语法范围，依赖、动态调用及实际运行行为没有因此获得全量证明。[导出证据包](../review-artifacts/qoder-audit-20260817/rea-evidence.json)。
- REA 的 Windows PTY 捕获不支持当前宿主的后代进程清理验证；该尝试明确失败，未换装工具。上述 CLI 执行证据来自 PowerShell 子进程记录，而非 REA 运行捕获。

## 建议顺序

1. **优先修模型能力和请求映射**：保留账号目录思考能力与合法等级，区分是否支持关闭、默认值和固定预算，确保 UI／Pi 设置能传到最终 Qoder 请求；未支持参数应明确拒绝或提示，不静默丢弃。补 high／none／预算／tool choice 的最终 wire 断言，以及 enable:0 回归。
2. **补上下文档位**：保留可选和默认档位，按账号能力验证 `context_length`，同步本地预算；不得默认提升可能收费的档位。明确缺失能力元数据与真实额度未知。
3. **按需补多模态**：核验官方上传、图片消息和工具图片往返；验证前继续明确拒绝，不只把 input 改为 image。
4. BYOK、企业、fast/function switch、新传输和官方远程会话按产品需求单独决定；不要把“完整 provider”变成盲目复制整套 CLI。
5. 获得明确账号联调授权后，在隔离配置中验证真实目录、最小推理、思考开关／强度、上下文档位、工具多轮与到期刷新。离线测试通过不等于已验收这些在线能力。
