# 验证、运行安全与交付

使用[实验合同](../templates/CASE-CONTRACT.md)界定每个新case。只验证新假设或修改影响；不为了“更放心”重发已通过真实请求，不自动恢复失败/放弃实验。

## 1. 证据阶梯

| 证据 | 可以说 | 不能说 |
|---|---|---|
| 字符串/导入/反编译/JS bundle | 绑定版本范围内有候选结构或静态行为 | 当前分支已执行、已发送 |
| mock/VM/合成测试 | 指定模型与输入的行为通过 | 真实平台/账号/wire对齐 |
| hook installed/attach ready | 观察器安装成功 | 捕获到实际sender或正文 |
| held进程身份/TCP归属 | 限定窗口内候选资源关系 | HTTP发送者、全部进程或完整请求 |
| pcap/TLS握手 | 捕获范围内包和协商字段 | 密文正文、PID排他归属、API retry |
| send前headers/body | 该构造边界的输入 | 中间件补头后的wire或服务端收到 |
| 代理HTTP观测 | 该代理边界的请求/响应 | 直连TLS/ALPN/服务端不可区分 |
| HTTP200/同答案 | 有限功能成功 | 全链路兼容或行为等价 |
| 独立进程内真实SDK闭环 | 该构建、SDK、账号/模型与caller场景可用 | 常驻服务已加载、UI端到端通过、worker自动注入身份 |

每条结论标观察/推断/未知。readback只是配置或文件生效，不代表目标行为通过；反编译器退出0也不等伪代码正确。

## 2. 测试阶梯与必要负例

| 层级 | 最小验证内容 |
|---|---|
| 纯函数/合成流 | 请求保真、可选字段/顺序、严格错误分类；UTF-8任意分片、坏帧、截断、缺终态、超限、重复工具ID、未知事件 |
| 认证状态机 | 正确/错误state、PKCE、device退避、token单位、注册过期、刷新锁/轮转、取消与迟到回调、账号变更、原子存储 |
| 本地HTTP | 最终method/headers/body字节长度、自动补头/redirect/代理隔离、慢头/慢体/断流、取消与late Response清理 |
| 宿主身份负例 | 注入宿主UA、`x-*`头、额外body字段和宿主会话ID后，最终协议字段在白名单内且无额外宿主标识；另用含Axiom/Pi/路径的合成caller内容验证原样保留，不能靠清洗上下文通过；认证/刷新/目录/推理/辅助分别覆盖 |
| SDK integration | 真实注册/认证/hooks/observer路径、真实全工具集/MCP序列化、工具一轮及结果回传/下一轮、主轮/summary身份、retry不叠乘、设置不丢失 |
| 独立封装 | 实际发射/包内入口与传递依赖齐全，plain runtime无Agent SDK/TS loader导入、存储/交互、干净例子 |
| 受控真实 | 用户授权的账号/模型/场景与真实SDK闭环；仅目标需要对齐时另取固定版本官方对照，各自独立认证 |
| 部署后 | 必要build/restart后核实际加载与新case；不把源码通过当已部署 |

流夹具应区分字段缺省、null、空串、空对象与非空值，不能只按标准类型定义猜实际增量语义。兼容修复须有版本/实际字段证据：安全空legacy不等旧式工具调用；已验证工具的后继空name可为无增量，不代表首次空name、改名或未知键也可接受。仍保留严格schema、完整终态与宿主审批。

offline只用合成凭据/上下文。禁止无意调用模型的generic Fetch；但tsx命名pipe、loopback端口等runner必需IPC须精确允许，不能把误杀runner当生产缺陷。未做OS网络审计就明确说未做。

先核cwd、安装版ESM exports/loader、raw baseUrl与展示字段、fixture目的地白名单；不要通过产品改动修harness。Axiom受控测试子进程尤其显式处理`AXIOM_EXECUTION_PROFILE`、`AXIOM_MODEL_ACCOUNT_BINDINGS`、`AXIOM_MODEL_MANAGED_ACCOUNTS`、`AXIOM_EXECUTION_INSTANCE`、`AXIOM_EXECUTION_GENERATION`五项继承快照；仅隔离自有子进程，不清父进程/用户配置，不绕过正常账号保护。

打包清单检查也可能触发生命周期脚本。先审阅实际工具版本和scripts，再记录真正执行的构建/安装/网络/服务动作；不能把`dry-run`、`offline`或`ignore-scripts`字面当无副作用证据。stdout可能混有构建文本，先检查格式再解析JSON；部分pack检查不等完整安装/升级/回退生命周期通过。

通过测试的文件未变就沿用；改变相关实现才重验受影响层。并行测试使用独立临时目录、端口和结果文件，测试期间不改被测文件。共享dist有漂移风险时冻结源码/依赖/产物，验证harness指纹；live claim唯一留正式证据目录，不随复制快照变出新预算。快照成功仍不证服务已加载。构建/fixture错误先排查修复，不因可修复问题停在Waiting。

## 3. 真实请求和差异对照

需要具体采集操作时读[抓包与最终请求对照](capture-comparison.md)：mitmweb 本机监听、局部 CA/代理、无模型预检、OpenCLI 页面 RAM 读取 flow、差集投影、CLI 对照与恢复。未授权时只复用既有证据，不自动安装/启动 MITM。

1. 合同写目标身份、账号模式（不写secret）、固定模型/思考、唯一输入/工具fixture、请求/时间/字节/额度上限、失败动作、清理责任。
2. 对观察器先跑**不调用模型**的自有fixture：传输/stdio不污染、时机能命中、输出有界、取消/迟到/清理路径正确。未经此门禁不反复空发探路。
3. baseline只保存必要公开元数据/ID；live前exclusive claim。若动作是否执行不明，保留unknown且不自动重放。
4. 统计所有新增物理请求：认证刷新、目录、主推理、工具后续、title/summary等。无法严格源绑定的辅助请求保留“形状相似但未知”。
5. 按矩阵比较method/path、字段存在与类型、顺序/字节、动态ID的关系与生命周期、状态/流终态、请求数量/等待。敏感值相等在RAM核，不输出原值。
6. 不把两套独立OAuth的token要求逐字相同；比较认证方式、scope/路由/profile语义及生命周期。不得删动态差异、保留内容或安全策略来人为制造相同。
7. 报告“匹配/已知差异/未知/不在范围”，不要把未知算通过。不以一次工具成功外推图片、reasoning、恢复或其他模型。
8. 停止owned run、释放观察器、恢复限定代理/配置并读回；不停止他人的抓包或服务。cleanup未证就保留未完成。

### 不扰动现有服务的SDK功能验收

- 先核当前默认/账号/代理与操作副作用：给新测试会话选模型也可能改全局默认。历史配置/PID不是当前事实，不为了测试恢复旧设置；无变更就只读回，不做多余“恢复”。
- 确需恢复全局默认时，先等目标run/Agent settled，不在starting阶段切selection；不对测试会话再选模型（会改写该会话显示）。用单独空会话恢复，读回测试会话selection、全局默认和UI显示，未知receipt先查状态不重发。
- 复现用户报告的失败，先用其精确provider/模型/思考档位与输入；相近档位或简化prompt的成功不能关闭问题。间歇协议失败缺定位字段时，先部署白名单诊断，再按预算复现。
- 部署后实发前核当前服务PID、启动时刻晚于构建产物、产物含本次改动；PID可能已被他处重启更换。修后成功若无法证明命中新分支，如实标注。
- 若目标是组件/SDK功能且常驻服务入口无法安全限预算，可用自有独立进程加载已验证构建、真实注册/账号路由/observer；明确未覆盖服务加载/UI。不要改成绕adapter直接调core，也不要冒充完整宿主上下文：新测试caller保持自有system/custom/history/tools/security；生产上下文保真仍单独验。
- 自有子进程的配置应明确绑定，避免继承不属于测试的执行快照/账号映射；只在该进程应用当前合法代理设置，不改父进程或机器设置，不盲目清空必要环境。
- 将只读metadata预检与取auth/目录联网分开，先用拒绝网络的门禁证零请求。正常授权的OAuth刷新可写回原凭据存储，不复制到fixture或调试目录；刷新成功只证明该刷新路径，不证明新交互登录。
- 分列semantic输入、主模型物理发送、认证刷新、profile/目录、title/summary/warming和工具预算。在真正发送前强制上限，不只事后计数；先核实际SDK层的重试owner，低层Agent测试不能替代AgentSession/宿主重试验证。
- harness导入不执行；先合成验证工具闭环、坏终态拒绝、活动取消/迟到清理及超预算拦截。保存测试源码和构建指纹，实发前匹配门禁通过的版本；每个新live case独占claim，真实失败后不能沿用它调试重发。
- 执行成功须包含精确输出、完整终态、call/result配对、工具回传、下一轮历史及身份关系；清理核活动体/observer计数、Agent settled、dispatcher关闭和owned进程退出。前后默认/代理/服务身份只存白名单；敏感配置全文仅RAM比较，不hash替代。

### 用 CLI 基线诊断故障

- 目的：分辨“服务端/账号/模型侧问题”和“我们的实现问题”，并拿到 CLI 处理同一事件或错误的方式。静态查证已经回答就不跑。
- 条件对齐：CLI用自己的正常登录，认证模式/账号权限条件、模型、思考档位与输入可比；对不齐的身份、system、工具、feature、预算差异要记录。官方不同登录模式成功不能直接裁决当前企业账号；CLI输出解析失败不等登录或请求失败。
- 判读：CLI 同条件也失败，先查服务端、权限或模型侧，不在 Provider 里绕过；CLI 成功而我们失败，逐项比对请求字段和流事件处理，按 CLI 语义修复；两边都间歇，记录频率，一次成功不算修好。
- 默认只取 CLI 自带输出或日志的白名单项（事件 type、状态码、错误码、计数）；不读 CLI 凭据缓存。若这层不足且另获明确授权，按[抓包流程](capture-comparison.md)使用局部 MITM；未授权不安装、不修改 CA/代理。
- 每次 CLI 执行都是 live case：新 claim、预算，失败即停。

MITM/插桩和未修改直连基线分轨；不关闭TLS校验、不改全局CA/代理/防火墙、不重签官方程序。隐私optout变更等降低保护的动作须独立明确决定，不因追求对齐自动采用。

## 4. 取消和观察器资源的通用门禁

- 只有明确创建/借用的资源可控制；借用证明仅query，身份/生命周期由caller维持。进程路径/创建时刻/原句柄与PID分别证，不重开已退出PID补证。
- 原始flags/参数/返回值不为观察方便而改。安装成功不证hook命中当前runtime；JS callback throw不保证底层原调用停止。
- acquisition对象一取得就登记owner；cancel race后仍要收拾迟到对象。不能仅Promise.race就释放同一共享策略给下一调用。
- 真EOF与写“解锁字节”不同。输出cap包括可知的缓冲副本；读完chunk后超限要报告可超出的边界。
- EOF/error/abort/close/consumer-cancel各出口都保存已收的有界白名单，不能只在end投影。取消意图先锁存再await reader.cancel，防并发pull的done误记EOF；后续回调不得覆盖首次出口。
- 外层read/cancel Promise完成不等底层pull finally已完成，清理须等待活动cancel计数归零。用受控延迟及并发负例验证，不靠单次即时计数误判泄漏。
- 协议完成（合法finish+DONE）与传输终止分开。只有真实证据及明确事件顺序支持的官方取消链可单独分类；不能把独立error/close当成功，也不能据此放松自己组件的工具完整终态/干净EOF门禁。
- 终止请求/close调用/join调用不等已停止；核实际settle、完整非空资源集合与权威终态。故障要单调，late callback不能把失败翻绿。
- 独立监督只在必要观察实验中使用；不把复杂注入基础设施变成所有供应商接入前置。

平台分别处理：
- **macOS**：Mach-O slice/Rosetta、LLDB/Frida权限、Hardened Runtime/SIP；进程组不等Windows Job，不能套NtResume方案。
- **Windows**：PE/ABI、原held HANDLE/Job、UTF-16长度/有符号状态、CRLF原字节；不从VM推出Native安全，不调整ordinary access/flags“修好”探针。
- **Linux**：ELF/ptrace/PTY/cgroup或进程组的实际权限与所有权；REA工具各自宿主范围单独核。
- REA `close_frida_session`是卸载/分离，不是kill；spawn暂停和cleanup未决必须按实际工具契约处置，不盲目resume。LLDB/process capture各自核其报告的owned终止。

## 5. 隐私与可检验报告

默认raw token/Authorization、真实上下文、请求/响应原文、未知错误只在RAM；避免traceback、stdout、HAR/REA完整导出旁路泄露。敏感值hash仍是敏感派生证据，不新增；静态公开代码/非敏感自有fixture可hash。正常认证/会话存储不等允许复制到调试报告。

白名单投影写固定分类、阶段、计数、预算、版本、相等谓词和必要非敏感定位。保存前核JSON重复键、nonfinite、bool冒充整数、未知字段、集合关系与空集合假通过；不能只看进程exit0。

区分实现违规、oracle错误、工具/环境启动失败。修oracle需证正确拒绝路径并保持断言强度；保留原失败、修正原因和新结果，不回写旧case。计数写“4项原PASS沿用+1项修正后新执行”，不是“最终整轮5PASS”。

交付用[交接模板](../templates/HANDOFF.md)，保存完整报告后才能精简索引；源码证据、合成测试、真实wire、部署状态分开。剩余条件明确到输入/授权/环境，且不把记忆规划当下一阶段授权。
