# REA 定位与证据复用

目的不是“把客户端全部反编译”，而是以最低成本回答接入所需的一个具体问题。先选问题及证据强度，再选工具。源代码充分时使用普通仓库工具，跳过REA readiness/doctor；缺口依赖发布产物或运行行为时才加载已安装的 `reverse-engineer-anything`。

## 1. 绑定真实目标

建立 `launcher → child/runtime → package/member → request sender` 图。分别记录版本、组件名、大小、静态代码SHA、格式/架构、来源和可重复定位方式。版本输出若需执行CLI，也属于目标执行，不能拿只读调查授权直接运行。manifest版本、launcher版本、嵌入SDK版本可能不同；依赖版本范围不等resolved版本。

- 路径或产品不明确才询问，不自行挑附近示例程序。
- 包先列成员再选入口；提取到新目录，不执行安装脚本、不覆盖用户文件，注意路径穿越/符号链接。
- 多架构产物记录整个文件及所选slice身份；静态文件匹配不自动证明已加载映像相同。
- 第三方逆向实现只是候选参考，记录版本/许可与出处，不用它代替官方产物证据。

## 2. 目标路由表

以下是REA操作名索引，不是可直接复制的参数；先发现当前server工具，再只读取要用的schema。工具缺失时标明所缺证据，不猜参数。

| 目标或问题 | 最小路线 | 主要限制 |
|---|---|---|
| 完整可读源码/公开SDK | 文档、明确文件、类型、调用链与本地fixture | 不为普通架构分析启动REA |
| Node CLI、ASAR、Electron JS | 包清单/入口 → 有界文本定位 → 必要时 `analyze_javascript_application` | 支持时用精确 `source_paths`；依赖不自动分析 |
| ZIP/DMG/安装包/嵌入脚本 | `open_binary`、必要的 `inspect_artifact` inventory，再选择成员 | 打开容器不等已分析实际runtime；不要先反编译bootloader |
| Mach-O/PE/ELF | 格式/符号/字符串/导入定位 → `open_binary` + focused function/xref | 大目标先确认engine策略和预算，打开可能触发冷导入 |
| Rust/Go CLI | 可用时先 `inspect_rust_binary` / `inspect_go_binary` 元数据，再native路线 | 元数据缺失不证不是该语言；编译器路径不是调用链 |
| .NET或其他managed产物 | `inspect_managed_artifact` 后定向成员；NativeAOT走native | 不把IL/伪代码当原源码，不混架构 |
| 已保存HAR/SAZ/mitm记录 | `inspect_web_network_capture`，summary后选择原record | 不重放URL；先确认记录可处理/保留的隐私范围 |
| 已存在浏览器/Electron | 选择明确target；按需 `list_browser_targets` / `list_electron_targets` | passive观察不等已执行点击或捕获此前流量 |
| 运行时调用/进程行为 | 依据REA runtime guide选LLDB、Frida或process capture | 这是执行/插桩，不是静态读文件；先过运行门禁 |

## 3. 先定位，再局部分析

1. 用固定端点路径、header键、grant_type、事件名或已知错误码作seed。查**明确文件**，输出偏移/命中数或短上下文，不打印minified全行；避免shell通配把 `.js.map` 也展开。
2. 为大bundle预先固定窗数、每窗/总字节、总时间；从字符串调用点找直接caller/callee。发现同名混淆符号先核所属模块和导入绑定，不跨scope拼链。
3. JS可直接提取小范围阅读；需要AST/graph时仅选明确文件。**`detail: "summary"`只缩返回体，不减少分析工作**，对15MiB等大单文件尤其不能当预算保护。source map单独选择，记录恢复代码与原文件range的对应。
4. Native需要反编译时，加载 `reverse-engineer-anything` 并按其 `references/native-and-artifacts.md` 执行（选函数、file-offset与地址、decompile超时、NativeAOT/PyInstaller等边界都以它为准）；技能不在可用列表就先请用户在Axiom启用REA集成。必要时先用自有小控制样本证明engine能导入/解码，再定向函数；Ghidra有受支持的noanalysis/局部路径时优先，不能捏造REA参数。PE `.pdata` 与Mach-O unwind/函数起点各按格式核。
5. 交叉检查原字节、ASM、完整函数范围、未解码gap、CFG/跳表与伪代码。异常大CFG/邻表越界先修分析模型，不继续无界std/allocator递归。类型注释/call-fixup不是原类型或源级缺陷证明。
6. 建立到真实sender及parser的最短数据流：值从哪里产生、经何转换、何时发送、哪种条件消费。字符串存在、xref、可达性、实际执行分别记录。
7. 证据足够就回到实现；若仍缺一条边，明确下一条边再查，不顺手扩成全客户端审计。

## 4. 复用REA结果，不重跑producer

- 保存实际 `evidence_id` / `parent_evidence_id`、source digest、operation、profile/限制；不能编造丢失ID。
- `inspect_analysis_view` 分页读取需要的module/函数facet；模块路径可能有多种graph role，优先选返回的准确 `node_id`。
- `trace_application_feature` 只跟一个seed和必要方向；both可能经containment展开兄弟模块，不把所有到达节点当功能参与者。
- native function summary不是完整dossier；需要调用路径/比较时用支持的retained引用或完整Evidence。分析内存可能有loader fixup，`read_bytes`不等原文件，更不等运行内存。
- 客户端截断或REA transport大小限制：取同会话保留结果的短页，不重新分析。partial/source coverage与page exhaustion独立；没找到不能在覆盖不全时说不存在。
- `close_binary`可能清理retained引用。需要跨会话保留时，先确认内容不含不允许落盘的原文，再导出可携带Evidence；敏感运行数据只保存白名单结论和限制，不导出整包以破坏RAM约束。

## 5. 故障恢复不变成另一项工程

| 实际失败 | 下一步 |
|---|---|
| 工具已连接且可用 | 直接查目标，不例行doctor/setup |
| 工具缺失/连接失败 | 读当前REA connection-and-recovery；区分注册、客户端重连、PATH、engine缺失 |
| 客户端tool deadline，无REA结果 | 不知道底层是否结束；核可用状态/结果/清理，不立即重复。idle session不证target-free工作停止 |
| REA返回provider_timeout | 复用partial，查实际超时阶段；只有返回remediation且预算允许才调整相应限制 |
| transport大小/客户端显示截断 | 读取retained短页；不要把summary当减轻分析负担 |
| cleanup_incomplete | 先恢复确切cleanup owner，不用新任务覆盖未释放资源 |
| schema不匹配 | 核当前schema并一次修正已报告字段，不猜旧版参数 |
| 注册确需修复 | 只读计划→核路径/备份/授权→限定写入→必要重连→回到原问题 |

不强装Hopper/IDA，不以没有native engine阻塞纯JS；不改全局工具链/安全策略。包下载、setup写配置与安装engine是独立影响。宿主与server截止时间分开，超时不自动等于OOM，不能照搬别的目标的30分钟预算。

## 6. 修复时查 CLI 的处理

修复已有 Provider 时，问题已经具体到一个事件名、错误码、字段或端点，比接入时更容易在 CLI 中定位。先查 CLI，再改代码。

- **seed**：失败诊断里的事件 type、错误 code、字段名、端点路径、HTTP 状态。在 CLI 的 parser、serializer、错误分类中找同名分支，记下它对该点是解析、放行、重试还是报错，以及相邻事件（如同族的 `*.added/*.done/*.delta`）怎么处理。
- **定位落空就换路线**，各自设时间/字节预算：
  1. 识别格式：Rust/Go/Node 单文件、压缩或内嵌资源（SEA、pkg、bun/deno compile 等）。明文 strings 为空常常只说明内容被压缩或内嵌，先做 inventory 再选成员；需要 inventory 或反编译时加载 `reverse-engineer-anything` 按其路由执行。也查 CLI 是否在旁边带了 JS 组件（如 Kiro 的 `kas/<版本>/` 下的 KAS），明文 JS 比反编译 native 便宜。
  2. 查同版本的公开源码或官方 SDK（同厂开源 CLI、协议 SDK 包），核版本对应与许可。
  3. 查 CLI 文档化的日志、调试或 trace 选项，以及它已写出的本地日志。只用 seed 定向检索，结果留 RAM；不碰凭据、token 缓存和 Keychain。
  4. 仍不足且已授权官方执行时，按[验证与运行安全](verification.md)「用 CLI 基线诊断故障」跑一次对照。
- **记录证据强度**：CLI 版本、位置、是静态分支还是运行观察。代码里有处理分支，不等于服务端一定发该事件；没找到也不等于 CLI 不处理。

## 7. REA来源与维护

本方法整合已安装REA **6.8.0** 的 `reverse-engineer-anything`（metadata version49）及其 `javascript-applications`、`native-and-artifacts`、`runtime-observation`、`evidence-workflows`、`connection-and-recovery` 指导，并加入CLI原生接入的有界调查经验；不是复制或替换REA安装。

实际调用以本机该技能目录的对应reference和工具schema为准，无硬编码用户目录/engine路径。上游：[REA项目](https://github.com/morluto/rea)；在线main可能比安装版新，不从中照抄未公布的工具参数。此技能自身不注册MCP，也不证明任一engine已就绪。
