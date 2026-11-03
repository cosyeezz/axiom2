# 社区 RTK 命中优化与上下文减量方案

调研时间：2026-10-29。对象：Axiom 当前内嵌 Pi 1.4.0、内置 RTK 1.0.1。

原调研范围：查阅官方仓库、npm 发布包、源码和当时 Axiom 接线；**调研阶段没有安装或运行候选插件、修改产品源码／用户配置或重启后台**。之后用户另行授权的 RTK 宿主实现与验证见下方定稿入口，不改变本报告其他候选方案的研究边界。下列版本是调研快照，不是永久最新版本；维护者给出的百分比不是本次实测。

前置问题及当前实效见 [RTK 实效审计](rtk-effectiveness-audit.md)。来源、版本、源码哈希见 [证据清单](evidence/context-reduction-community/sources.json)，检查范围与结果见 [核验记录](evidence/context-reduction-community/verification.md)。

## 当前定稿范围

用户已确认采用 **官方 RTK 底座及官方后续版本，参考 Pi 维护插件优化 Axiom 宿主接入**。保持零新增提示词、零额外模型调用；不直接叠装整个插件，不维护自有 RTK 引擎分支。大内容方案暂缓。

最终范围、升级原则与实现结果见 [RTK 接入优化定稿](rtk-optimization-plan.md) 和 [实施验收记录](evidence/rtk-front-rewrite/README.md)。用户已另行授权并完成宿主实现及隔离验证；未安装整包插件、升级生产引擎或重启后台。以下保留调研时的完整结论与候选分析，不代表其他方案也进入开发范围。

## 结论

社区有可借鉴方案，但应分成三个不同问题：

1. **执行前识别和重写命令**：提高 RTK 可处理的命令覆盖，而非放开混合输出的后处理。
2. **大结果先留在本地，按需返回片段或计算结果**：这是降低首次进入模型上下文体积的主要手段，不限于 RTK 支持的命令。
3. **清理已经使用过的历史输出**：降低之后每轮重复携带的成本，不能与“首次没有进入上下文”混为一谈。

调研时的广义优先级建议是：**安全的 RTK 前置重写 → 原生 Code Mode／大结果本地索引 → 缓存感知的历史裁剪**。当前定稿只推进 RTK 接入方案，后两项暂缓，不是自动排期的后续任务。不建议直接叠装多种工具结果改写扩展。

## 一、社区如何提高 RTK 覆盖

### 官方 Pi hook：从后处理改为前置重写

[RTK 官方 Pi hook](https://github.com/rtk-ai/rtk/blob/v1.1.0/hooks/pi/rtk.ts) 在 `tool_call` 调用 `rtk rewrite`，只在返回码 0 或 3 且有输出时修改命令，超时／不可用时使用原命令。实际过滤随命令执行发生。

与调研时 Axiom 的原路径比较：

```text
Axiom 原路径：整个 shell 命令执行 → SDK 收集／截断 → 根据命令猜输出格式 → RTK pipe
社区做法：解析命令 → 对可安全处理的命令段加入 RTK → 执行 → 已减量的结果
```

[上游重写实现与测试](https://github.com/rtk-ai/rtk/blob/v1.1.0/src/discover/registry.rs) 可以逐段处理部分 `&&`、`||`、分号和多行命令；某些管道只重写安全末端。例如源码测试包含：

- `git status && cargo test`：可分别识别可支持段。
- `git log | grep feat`：保留生产者，重写为 `git log | rtk grep feat`。
- `find … | xargs …`、`… | wc -l`、heredoc 等不安全路径仍保留原样。

这说明提高命中率不必以“把所有混合输出套进一个过滤器”为代价。但前置重写本身也改变执行路径，必须测试 shell 语义、退出码、错误诊断和权限；上游测试存在不等于已验证 Axiom 的工作负载。

**版本发现**：调研时上游为 v1.1.0；上述 Pi hook、`pipe_cmd.rs`、`toml_filter.rs` 与 v1.0.1 内容相同，已做逐字节比较。因此这些机制不是升级到 1.1.0 后才有，**仅升级二进制不会改变 Axiom 当前接入方式**。

### 自定义过滤器与机会分析

[上游 TOML filter](https://github.com/rtk-ai/rtk/blob/v1.1.0/src/core/toml_filter.rs) 支持项目级规则、去噪、保留／删除行、替换、限行和内联测试，并有 `rtk trust`、`rtk verify --require-all`。不过 [当前 pipe 入口](https://github.com/rtk-ai/rtk/blob/v1.1.0/src/cmds/system/pipe_cmd.rs) 使用固定过滤器名单，**Axiom 目前的 pipe 接法不会自动消费这些自定义规则**。

Node/tsx TAP 仍没有专用适配。应为常用测试格式增加真实解析，而不是只保留 `ok/not ok`；失败 YAML、堆栈、嵌套子测试、skip/todo 和汇总需要保真。对于失败输出，目前 Axiom 的原文旁路不应直接取消。

`rtk discover` 的当前 provider 实现读取 Claude 历史，不是 Axiom/Pi 会话；`gain` 的 token 数含字节估算。可借鉴“未支持命令族 × 输出体积”排序，但仍使用 Axiom 自己的统计／回放验证。

## 二、值得考虑的插件与工具

### 候选总览

| 方案 | 实际减少什么 | 对当前 Axiom 的判断 |
|---|---|---|
| 官方 RTK hook／`@estebanforge/pi-rtk-optimizer` | 前置命令重写；后者另有 bash/read/grep 规则压缩 | 最适合借鉴覆盖机制；不能与内置 RTK 无脑叠加 |
| **Context Mode** | 本地执行、文件／网页索引、检索片段 | 适合大日志／文档；需路由与权限适配，ELv2 许可须评估 |
| **Chisle** | 大 shell／搜索／文本 MCP 结果的去噪、去重和头尾裁剪 | 轻量兜底候选；默认不压 read，不是语义摘要 |
| **pi-dynamic-context-pruning** | 重复、过时或被覆盖的历史工具内容 | 无额外模型调用，适合第二阶段；有缓存和恢复 UI 边界 |
| **pi-condense** | 首次大结果确定性落盘；完成批次／调用链的可回查摘要 | 落盘不需摘要模型；语义摘要另有费用／延迟，需依赖与宿主适配 |
| **Headroom** | 代理／库层按内容类型压缩，提供原文恢复 | 广覆盖但接入最重，不建议作为首个改动 |
| `@spences10/pi-context` | 大文本改成 SQLite 索引回执，提供 search/get/export | 架构很合适，但声明 Node ≥24.15，不适配当前检查环境的 Node 22 |

### 1. Pi RTK optimizer：最接近现有功能的社区实现

- [原项目 MasuRii/pi-rtk-optimizer](https://github.com/MasuRii/pi-rtk-optimizer)，发布版 0.9.0 的 peer 范围只覆盖 Pi 0.74–0.80，不宜作为当前 Pi 1.4.0 的直接安装推荐。
- [维护 fork：EstebanForge/pi-extensions](https://github.com/EstebanForge/pi-extensions/tree/main/packages/pi-rtk-optimizer)，npm `@estebanforge/pi-rtk-optimizer@1.0.4`，MIT；声明 Pi `^1.0.0`、Node ≥22。
- 发布源码 `lib/index.ts` 在 `tool_call` 委托外部 `rtk rewrite`；在 `tool_result` 对 bash/read/grep 的文本应用规则压缩，不是只折叠 UI。
- 另有 `before_agent_start` 可选提示词注入支路。当前定稿只参考宿主前置重写，不带入提示词注入、suggest 或泛化结果压缩，不能直接整包安装后宣称零提示词侵入。
- **read 有损压缩默认关闭**。这个默认值得保留：源文件缺行会使后续精确 edit 失败；“只留下函数签名”不适合作为默认精确读取契约。
- 未发现独立完整原文归档／检索工具，不能承诺所有压缩均可逆。优先借鉴前置重写，而不是开启全部压缩选项。

### 2. Context Mode：最符合“大文本不要先进入上下文”的方向

官方仓库：[mksglu/context-mode](https://github.com/mksglu/context-mode)。

版本需区分：npm `latest=1.0.169`，`next=2.0.0-next.11`；本次机制审查固定 main 提交 `49b318b5…`，**不把 main 的源码发现当成 latest 发布包已通过运行验证**。

[工具实现](https://github.com/mksglu/context-mode/blob/49b318b5b894d286cda891732287400d9b43cea3/src/server.ts)：

- `index(path)`：服务器直接读文件／目录并分片，避免模型先收到全文。
- `execute_file`／`execute`：程序处理原始数据，只输出选出的字段、计数或片段。
- `search`：SQLite FTS5／BM25 等词法检索，不依赖额外摘要模型，也不是向量检索。
- `fetch_and_index`：网页先抓取和索引，随后按需检索。

必须注意：

1. **安装 MCP 不会自动接管现有 read/bash**。模型需要选择新工具，或宿主提供路由。
2. [Read hook](https://github.com/mksglu/context-mode/blob/49b318b5b894d286cda891732287400d9b43cea3/hooks/core/routing.mjs#L843-L867) 即使发现大文件也只是增加提示，没有阻止原读取；却会记录 `bytesAvoided=fileSize`。因此其统计不能代替真实模型入口测量，“节省 98%”不能直接套用到 Axiom。
3. [Pi adapter](https://github.com/mksglu/context-mode/blob/49b318b5b894d286cda891732287400d9b43cea3/src/adapters/pi/extension.ts) 自建 MCP bridge，而 Pi 1.4.0 已有原生 MCP。应选单一连接路径，避免重复进程／工具。
4. 所谓沙箱主要是本机子进程边界，不是 OS 安全隔离。任意 execute 仍能访问文件、网络、进程凭据；不能借此绕过子代理工具限制。
5. Node ≥22.5，含原生 SQLite 依赖和安装脚本；[ELv2 许可](https://github.com/mksglu/context-mode/blob/49b318b5b894d286cda891732287400d9b43cea3/LICENSE) 不是 MIT，托管或分发集成需审查。

### 3. Chisle：低成本、与命令语法无关的兜底

[JayPokale/Chisle](https://github.com/JayPokale/Chisle)，npm 3.8.1，MIT、Node ≥18、无运行依赖。对已完成的文本做确定性处理，不另外调用模型。

[Pi 扩展](https://github.com/JayPokale/Chisle/blob/1b3203fe394ee84ca143a1e8636fafa8e9e1f906/pi-extension/index.js) 返回替换后的工具结果，默认覆盖 bash/powershell/grep/find/ls/文本 MCP，**明确排除 read/edit/write**。复合命令不会因命令语法被跳过，但也没有针对复合语义的理解。

[压缩核心](https://github.com/JayPokale/Chisle/blob/1b3203fe394ee84ca143a1e8636fafa8e9e1f906/hooks/chisle-compress-output.js) 默认超过 8,000 字符时保留首 60 行、尾 40 行和最多 12 条错误样式行；这是裁剪规则，**不是严格 8,000 字符上限，也不保证保住所有重要事实**。spill 最多 40 份，保存的是去噪后文本，写盘失败仍可能裁剪，不能当永久无损归档。

[MCP wrap](https://github.com/JayPokale/Chisle/blob/1b3203fe394ee84ca143a1e8636fafa8e9e1f906/hooks/chisle-mcp-proxy.js) 是 stdio JSON-RPC 代理，在返回宿主前改文本，不改 `structuredContent`。Pi 插件和 MCP 代理不能视为相同的数据契约。项目还会注入简短回答／代码风格指令，评估输出压缩时应把这部分影响分开。

### 4. Pi 输出落盘与历史裁剪：DCP 与 Condense

[pi-dynamic-context-pruning](https://github.com/diegopetrucci/pi-extensions/tree/main/extensions/dynamic-context-pruning)，0.1.15，MIT：

- `context` 钩子裁掉重复调用、陈旧错误参数及被覆盖文件内容；原始 session 保留。
- 不额外调用摘要模型，按分支持久化裁剪决策，有 prompt-cache 净收益门槛。
- 自动裁剪不依赖 TUI，但人工 `/prune` 恢复依赖 UI/RPC；当前 Axiom 没有绑定对应扩展 UI，不能假定恢复窗口可用。没有面向模型的原文检索工具。
- 主要解决旧结果反复携带，不是通用的首次大结果隔离。

[pi-condense](https://github.com/jjuraszek/pi-condense)，2.13.1，MIT：

- `turn_end` 捕获完成批次，`context` 中替换为摘要／短引用，`context_tree_query` 可取原始结果。
- **启用后，结果达到 65,536 字符即可在首次发送给模型前确定性 spill 到 sidecar**，下次请求改为预览、路径和查询引用；这条路径先于摘要预算判断，不需要额外摘要模型。受保护内容不处理，写盘失败保留原文。
- 默认关闭；通常的语义摘要需要额外模型请求，默认非交互流程可能到最终回复才摘要。若要运行中提前做语义摘要，可配置预算等触发条件。不要把这项限制误用于前述 eager spill。
- 文档要求 Pi ≥1.3，当前版本满足。但发布包运行时导入 `@sinclair/typebox`；当前 app 仅能解析 `typebox`。安装时须满足它声明的 peer 依赖，不能因已有 Pi 就认定依赖齐全。
- 摘要调用的费用、取消、并发和日志归属必须接入 Axiom 的宿主约束；不应让插件成为未计量的第二条模型调用链。

### 5. Headroom 与 pi-context：适合作为后续方向

[Headroom](https://github.com/headroomlabs-ai/headroom)，Apache-2.0，main `pyproject` 为 0.42.0：内容类型路由、JSON／代码／文本压缩和 CCR 本地原文恢复，可作代理、库或 MCP。代理模式可覆盖更多请求，但会进入鉴权、网络、流式、prompt cache、请求用量和恢复工具协议，接入风险显著高于本地工具结果处理。匿名 beacon 默认开启、可关闭；Python CLI 与 npm TypeScript SDK 不是同一安装入口。

只装 Headroom MCP 不会自动拦截旧工具；**把已经读进历史的大文本再传给 compress 工具，不会撤销此前的上下文消耗**。必须在工具返回或模型请求发送前接入。

[@spences10/pi-context](https://github.com/spences10/my-pi/tree/main/packages/pi-context)，0.1.16，MIT：通用 `tool_result` 将超过 24 KiB 或 300 行的文本存 SQLite，返回 receipt，并提供 search/get/export。很接近 Axiom 所需的输出侧索引；但要求 Node ≥24.15，而当前检查环境为 22.23.2、Axiom 最低要求为 22.19，**不作为现在开箱即用的推荐**。存储前会脱敏，7 天清理，也不是严格字节级原文永久库。其当前 hook 会把整个 `content` 替换为单条文本回执，**长文本与图片等混合结果中的非文本块会被丢弃，也没有存入 SQLite**；不能当作通用、完整原文回查方案。

其他可参考方向：[OpenCode DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) 是不同宿主的插件，当前 README 已说明开发重心转向 Sleev，不能当 Pi 插件直接装；[Serena](https://github.com/oraios/serena) 用符号导航替代全文代码读取，适合源代码场景，不是通用日志压缩器。

## 三、Axiom 已经有的原生替代：Code Mode

[Pi Code Mode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md) 允许模型写小段 JavaScript 调其他工具，**中间工具结果不直接进入会话，只返回脚本显式输出的内容**。

当前安装文档及实现确认：

- 使用 QuickJS；脚本没有 Node API、文件系统、网络或定时器，外部操作通过宿主工具。
- nested 工具调用仍经过 `tool_call`／`tool_result` 权限链，不直接生成 transcript 工具结果。
- shell 程序化输出可取得最多约 1 MiB，MCP 脚本取得完整结果；可以在模型看见之前筛选／聚合。
- 它不是自动摘要器：脚本如果原样 `return` 全部输出，仍然会产生大上下文；需要任务指令、输出预算与合适工具。

Axiom 的 [capability-resources.ts](../app/src/server/capability-resources.ts) 已在有选中 MCP 时注册 Code Mode；不是所有无 MCP 会话都已经具备，也不能仅加一个设置就假定已加载。对子代理仍需宿主显式授权。

相较引入另一个任意代码执行沙箱，优先复用这个权限链更短、已有实现的机制，值得作为最小试点。

## 四、不能跳过的集成边界

### 主、子代理不是同一插件加载范围

[agent-worker.ts](../app/src/server/agent-worker.ts) 对子代理清空 packages、设置 `noExtensions: true`，并限制工具白名单；内置 RTK 是宿主另行注入的。**用户安装一个 Pi 插件或 MCP，不会自动获得与内置 RTK 相同的子代理覆盖**。

对子代理需要的是宿主控制的只读 ingest/search/read-range 等能力，不是借新增任意 execute 绕过现有边界。

### 文本压缩与程序化数据契约分开

Pi 1.4.0 的扩展 runner 在插件替换 `content` 却未提供 `structuredContent` 时，会删除旧结构化值，以防不匹配。检查的 optimizer、Chisle Pi 扩展和 pi-context 返回的都是 content-only 替换。因此它们可能影响 nested／Code Mode 调用的数据形态。

这与“结构化原文回灌模型”不是一回事。宿主集成应：

- 保留有明确 `outputSchema` 的程序化结果；或跳过 nested，专门在模型入口缩减文本。
- 只索引纯文本，或保留混合结果中的全部非文本块；不能让单条回执吞掉图片等内容。
- 明确哪个阶段拥有压缩，避免 RTK、通用裁剪、索引回执互相二次处理。
- 写盘或索引失败时保留原文，不在无法恢复时继续破坏性裁剪。
- 保留退出码、失败／警告／测试计数，记忆、技能和精确编辑读取不做默认有损压缩。

## 五、建议的最小验证顺序

以下为原研究的候选验证路线，仅 RTK 接入优化已获授权实施并完成隔离验证。涉及 Node/tsx TAP 的解析能力优先交给官方 RTK／上游贡献，不在 Axiom 内维护引擎分支；大内容与历史裁剪试点均暂缓。实际实施范围以 [定稿方案](rtk-optimization-plan.md) 为准，验证结果见 [验收记录](evidence/rtk-front-rewrite/README.md)。

1. **覆盖试点**：参考官方 RTK rewrite，单一接线、默认白名单；原始命令与改写命令都经过宿主权限检查，不让 RTK 包装绕过授权。用真实复合命令、管道、引号、重定向、失败退出码验证。补 Node/tsx TAP 适配，跳过已确认无收益的 status 路径。
2. **大结果试点**：先复用 Code Mode；借鉴 Condense 无需摘要模型的 eager spill，对日志／网页／目录结果增加“完整原文落盘＋短回执＋按需 search/read-range”。Context Mode 可作为外部原型对照，但先审查许可、版本和任意执行权限。
3. **历史试点**：优先确定性、缓存感知 DCP；确有长调用链需求时再考虑 Condense 的模型摘要。先补模型可恢复入口，再自动裁剪。
4. **统一验收**：同一命令集、原文快照和任务问题，比较实际模型入口字节／token、命中与净收益、正确性、原文回查次数、总工具调用与延迟、摘要费用及 cache hit。分别统计主／子代理与 read/bash/MCP。

不要把“支持更多命令”“工具显示变短”“索引统计称避免了多少字节”直接当成最终收益。上轮审计的最近 5,000 条 RTK 记录只有 0.8% 次数命中；新方案应证明整体上下文确实下降且任务答案不变，而非只让这个局部比例变好。
