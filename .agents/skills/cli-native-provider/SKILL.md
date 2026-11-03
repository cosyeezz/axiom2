---
name: cli-native-provider
description: Build reusable native model providers from vendors that ship a CLI or desktop client. Use for CLI-backed vendor onboarding, OAuth and request-chain reconstruction, REA-assisted focused analysis, native transport and streaming implementation, SDK adapters, and version-bound parity validation. Do not use for ordinary documented API configuration or assume CLI subprocess bridging. Also use when diagnosing or fixing a failing native provider (HTTP errors, unknown stream events, terminal mismatches, rejected tools), and first check how the official CLI handles the same request, event or error. Use symptom-led triage and authorized capture comparison. Do not add host (Axiom/Pi/SDK) identity or local metadata to the CLI-shaped protocol; preserve caller context and security.
compatibility: Repository tools suffice for available source; REA and native engines are optional and target-dependent. Runtime observation requires an authorized target, supported host, and explicit budgets. Load the installed SDK and REA skills when their interfaces are needed.
---

# 带 CLI 供应商的原生 Provider 接入

目标：**把官方 CLI 当协议证据，把原生 Provider 当交付物**。不靠反复调用模型试错，不把 CLI/ACP 代发或 OpenAI 兼容反代冒充原生接入。供应商可以带 Node CLI、Electron、原生二进制或多进程启动器；先识别实际后端，不凭产品名判断协议。排查和修复故障时，**先查官方 CLI 怎么处理同一请求、事件或错误，再改实现**。

## 首要准则：请求与 CLI 一致，不暴露宿主身份

以下八条优先于本技能其他内容，每次实现、修复和验收都要逐条核对。冲突时以这里为准。

1. **只发 CLI 也发的协议字段。** header、query、body 字段按 CLI 证据建白名单生成。宿主、Pi 等 SDK、调用方额外注入的 UA、`x-*` 头和元字段丢弃、覆盖或拒绝，不透传；caller真实上下文仍映射到协议的内容字段。
2. **协议字段值和 CLI 同源。** UA、origin、profile、token 类型、attempt 等按 CLI 的生成逻辑填写，版本跟随取证的 CLI 版本。其中不得额外夹带 Axiom、Pi 或 SDK 的名称和版本；不能伪造真实账号属性。
3. **不额外带出本地元信息。** 宿主会话 ID、工作区路径、用户名、主机名、内部账号映射不得自动注入协议身份/metadata。协议需要的 ID 按 CLI 规定格式和生命周期生成，不复用宿主内部 ID。用户真实 system/custom/history/tools/security 中的路径或名称不属额外身份注入，不得为去品牌或对齐而删改。
4. **按实际发出的请求验证。** 构造出的 headers 对象不算数。在原生 HTTP 层受限捕获最终发出的 header 名和 body 字段名，断言没有白名单外的项、没有宿主标识。认证、刷新、目录、推理、辅助请求每条路径分别覆盖。删除显式 UA 不等于没有默认 UA；统计 observer 只能包装原生 sender，不能换成通用 Fetch。
5. **行为也和 CLI 一致。** 事件解析、终态、错误分类、重试和 attempt 头都照 CLI 实现，修复先查 CLI 怎么处理同一点（见下文“修复故障”）。暂时做不到的列为已知差异，不能静默不同，也不能自行加 CLI 没有的拒绝条件。
6. **不伪造。** 正常独立认证，不复制 CLI 缓存、Keychain 或其他应用凭据；不伪造权限、profile、设备身份或签名。目标是不多发信息，不是让服务端认不出这不是官方 CLI，后者属于检测规避，不做。
7. **不夸大一致的范围。** 认证链、refresh、恢复、错误、辅助请求、HTTP 版本、连接复用、直连 TLS 未核完时，只说“限定范围对齐”，不称“整体一致”或“服务端不可区分”。推理 UA 对齐不证明 refresh 也对齐；header 名称集合相同不等于值和 wire 相同。
8. **证据只存白名单字段。** raw token、Authorization、真实上下文、请求和响应原文、未知错误只留 RAM。日志和报告只记字段名、固定分类、计数和结论，不用敏感原文的 hash 代替。正常应用凭据存储与调试证据是两回事。

交付报告逐条写明这八条的状态：已证、已知差异或未验。

一个库可以承载多个供应商，但各自独立认证、请求策略和状态；上层 SDK 使用薄适配器。Provider 不是行业统一协议；统一的是我们自己的进程内契约，不是把上游 wire 强行改成一种格式。

## 先选交付级别

- **功能接入**：指定账号/模型/能力可正确使用，明确尚未支持的项。
- **可复用 Provider**：原生核心不依赖宿主 SDK，认证与状态有清晰生命周期，目标 SDK 集成通过。
- **限定范围对齐**：指定官方版本/平台/认证方式/场景的构造及实际发送已对照。

另外分开报告**源码实现、分发产物、独立SDK实发、服务加载、UI端到端**；独立测试进程成功不代表现有后台已加载，显式传入身份不证明worker自动注入。三种交付目标不能互相替代，一致性的表述按首要准则第7条。技能本身不授予执行目标、花费额度、安装工具、抓包或降低隐私保护的权限。

## 两条快速入口

- **新接入**：按[最短纵向闭环](references/fast-paths.md)从版本化证据→无网核心→本地HTTP→实际SDK→必要实发推进。
- **旧排障**：先查[症状→最短检查](references/fast-paths.md)定层，再按下文先查CLI；失败先留够诊断，不先反复重发。
- **需要历史因果**：查[Kiro版本化教训](references/kiro-lessons.md)，用其方法，不照搬模型参数、旧端点和授权。

## 快速启动：先交付最短闭环

1. 从当前对话、任务树和现存证据恢复：**目标与范围、产物身份、已验证结果、失败/禁跑项、活动资源、唯一下一步**。不用历史PID/授权代替当前事实，不恢复已结束失败或放弃分支。
2. 明确供应商/产品/CLI、宿主平台、认证方式、一个固定模型、目标 SDK，以及是否要求对齐。已有资料足够就不重复询问；名字歧义才问。不要把同厂不同产品视为同协议。
3. 在调用方仓库新建独立工作目录，填写[接入工作单](templates/ONBOARDING.md)。优先查官方文档、已有公共 SDK/完整源码和已保存对照；能直接回答的，不启动 REA。
4. 选一个未知点，按[REA 定位路线](references/rea-workflow.md)拿足够证据，填[协议矩阵](templates/PROTOCOL-MATRIX.md)。先解决“能否独立认证、选正确模型、构造和解析一次调用”，再逐层扩展。
5. 尽早实现无网络的请求构造/解析夹具，再接本地 HTTP 与实际 SDK；最后才为必要真实验证建立新[实验合同](templates/CASE-CONTRACT.md)。一个阶段已有充分证据即前进，不为凑计数重跑。

## 分阶段执行与退出条件

| 阶段 | 必做动作与交付 | 何时进入下一阶段 |
|---|---|---|
| A 身份与范围 | 记录产品、来源、版本、大小/SHA、平台/架构、launcher→runtime→bundle；列明授权与目标能力 | 选定对象，不把旧版本地址/模型/凭据沿用为当前 |
| B 最小协议地图 | 找认证入口→profile/目录→上下文构造→serializer→真正sender→流解析/终态；记录来源范围 | 主调用可解释；未答部分明确标未知，不无界扩读 |
| C 认证与目录 | 按认证模式恢复注册、scopes、换码/轮询、刷新、持久化、退出及目录/profile策略 | 合成成功/错误/取消/账号切换测试通过；不拿登录成功当模型权限 |
| D 独立核心 | 请求域类型、固定目标、按CLI白名单生成并覆盖宿主注入的头、原生传输、增量解析、工具关联、取消和错误边界 | 无宿主SDK的本地文本/工具往返；按CLI区分合法终态，坏终态不放行工具；最终请求无白名单外协议字段及额外宿主标识 |
| E SDK 适配 | 消息/事件映射、工具调度分工、身份进度、重试归属、observer及配置入口 | 实际SDK调用仍走预期sender，用户上下文/设置不丢失 |
| F 有界实发 | 先核非模型观察器，再对已授权场景一次性claim，关联全部物理请求并读回恢复 | 按选定验收级别逐项过关；失败停当前case，不重用claim |
| G 封装与交付 | 公共导出实际发射/打包、分发依赖闭包、无宿主SDK导入、例子/能力表；如需部署，核实际加载 | [交接清单](templates/HANDOFF.md)说明通过、差异、未知、限制与下一步 |

C/D可在契约明确后并行准备，最终E依赖两者。审查与独立夹具可委派，主代理修改实现；共用账号、代理、端口、可变REA session或工作树测试的任务必须协调，不能并发争用。

## 修复故障：先看 CLI 怎么做

已有 Provider 出错（HTTP 4xx/5xx、未知流事件、终态不符、工具或 Schema 被拒、间歇失败）时，官方 CLI 是首选证据来源，不是最后手段。按顺序做：

1. **记下失败条件**：模型、思考档位、输入、工具集、HTTP 状态、协议码或事件名。缺定位字段就先补白名单诊断。
2. **静态查 CLI 对同一点的处理**：以事件名、错误码、字段名或端点为 seed，在 bundle、二进制或同版本公开源码里找 parser/serializer/错误分类分支，记下 CLI 是解析、放行、重试还是报错。方法见[REA 定位路线](references/rea-workflow.md)第 6 节。一种定位方式落空就换下一种，不要一次 strings 失败就放弃 CLI 路线。遇到 native 二进制需要反编译，或者明文 strings 为空、需要先列出内嵌资源时，加载 `reverse-engineer-anything` 技能，按它的流程做（见下文“深入时按需读取”后一段）。
3. **必要时跑 CLI 基线**：静态答不了且已授权官方执行时，用 CLI 自己的正常登录、相同条件跑一次独立对照（新 claim、预算），判读见[验证与运行安全](references/verification.md)「用 CLI 基线诊断故障」。未授权就先问。能从 CLI 查到的，不靠反复实发自己的 Provider 等复现。
4. **按 CLI 语义修复**：夹具采用 CLI 证据中的形状；没有 CLI 证据的部分标为推测，不拿 OpenAI 等通用文档代替。报告写明修复依据来自 CLI 哪个版本、哪一处。

边界不变（首要准则第5、6条）：CLI 只作证据和基线，不代发；不读或复制 CLI 的凭据缓存；CLI 日志可能含上下文，只在 RAM 中按白名单取值。

## 深入时按需读取

| 正在回答的问题 | 参考 |
|---|---|
| 新接入如何最短闭环、旧故障如何按症状定层 | [快速路径与排障索引](references/fast-paths.md) |
| Kiro历史踩坑的因果、版本和旧结论替代关系 | [Kiro版本化教训](references/kiro-lessons.md) |
| 什么产物、用哪个REA工具、怎样避开全包分析与重复超时 | [REA 定位与证据复用](references/rea-workflow.md) |
| 修复时怎样查CLI对同一事件/错误的处理，定位落空怎么办 | [REA 定位](references/rea-workflow.md)第6节、[CLI基线诊断](references/verification.md) |
| 注册到推理的完整链路，字段来源、动态ID、headers、错误和重试 | [认证与协议还原](references/protocol-reconstruction.md) |
| 怎样建请求白名单、剥离宿主注入、测试最终请求不含宿主标识 | [认证与协议还原](references/protocol-reconstruction.md)第4、5节、[验证](references/verification.md)第2节 |
| 如何同时接多供应商、多SDK而不丢能力或串账号 | [Provider 架构与 SDK 接口](references/provider-architecture.md) |
| 怎么设计离线/本地/真实对照，管理取消、采集和敏感数据 | [验证与运行安全](references/verification.md) |
| 怎样用 mitmweb/OpenCLI 抓两端 HTTPS、RAM 差集比较并恢复 | [抓包与最终请求对照](references/capture-comparison.md)（含工具命令、局部 CA、基线及差异表） |
| 为什么特别检查UA、observer、continuation和多层重试 | [个案提炼与历史定位](references/case-lessons.md) |

涉及REA时再加载当前安装的 `reverse-engineer-anything`：使用真实工具清单/schema及其对应参考，不把本技能中的操作名当可执行签名。它装在 `rea-agents` 包的 `skills/reverse-engineer-anything/SKILL.md`，安装目录含版本号和随机 ID，所以按技能名加载，不写死路径。Axiom 中需要先启用 REA 集成，技能才会出现在可用列表里；没出现就请用户启用，不自行改 REA 配置或手动定位旧版本目录。反编译、选函数、超时和特殊格式的具体做法以该技能的 `references/native-and-artifacts.md` 为准，本技能只给概括，不复制它的内容。涉及Pi或其他SDK时读**安装版本**的文档、公开类型和必要实现；不修改node_modules作为持久方案。

## 不可省略的工程边界

首要准则已覆盖身份、请求一致、伪造和隐私；以下是其余边界。

- 先核账号/组织允许的授权方式。
- 保留caller system/custom/history/tools/security与真实认证/profile。支持不了的参数明确拒绝或报告；不能删内容、换模型或静默fallback制造成功。
- 认证、目录和推理可能使用不同协议/主机/传输，各自按首要准则核对。
- session、逻辑run、模型invocation、物理attempt、tool call、server response是不同身份。缺少恢复依据就不猜；辅助/title/summary从可信调用入口识别。
- 单次sender不等全会话单次请求。明确SDK/Provider/transport的重试所有权；用户disable/zero/cap优先。成功Response后的解析或工具失败不得被另一层隐式重放。
- caller取消可以立即返回，但底层SDK acquisition未settle就不能释放共享state给后继。每个异步边界核signal/账号epoch；迟到Response清理，不迟到发送或执行工具。
- 实发前核模型选择接口是否改全局默认，及认证/目录/辅助调用的副作用。可用独立SDK测试进程保持现有配置，但须保留所选层级的完整caller上下文、正常账号路由和预算；它不是CLI代发，也不能冒充生产UI验收。
- 不改全局CA/代理/防火墙，不关闭TLS校验/SIP，不重签官方目标来伪造基线；必要的局部观察配置须限定作用域并恢复读回。

## 证据与停止规则

每条结论分为**观察、推断、未知**，附版本、位置/证据ID和覆盖边界。静态代码不证执行，mock不证wire，HTTP200/相同答案不证等价，MITM不证直连TLS。

- 每项调查先写问题、成功判据、时间/内存/字节/次数预算。只有新的具体缺口才扩展；工具超时先分类，不无条件加预算重试。
- 有副作用的live case先exclusive claim（如`wx`/CreateNew），成功、失败、超时均耗尽。修改后的新尝试须有新身份/合同；普通离线测试按源码变化重验受影响部分，保留失败日志，不重复计数。
- 实验失败、门禁未满足、资源未清理即停该实验；保存原因与恢复条件。实现/fixture可修复问题继续处理，不拿文档交接冒充实现完成。
- 复现用户失败先用其精确模型/思考档位/输入；间歇协议错误先上线白名单诊断（如过滤后的事件名）。修后实测要能证明命中新路径，否则标未证。
- 回答够用就停止调查，回到接入实现。交付时列命令/退出码、实际新跑与沿用覆盖、仍有差异和未验证能力；不把多个局部PASS拼成全链路PASS。
