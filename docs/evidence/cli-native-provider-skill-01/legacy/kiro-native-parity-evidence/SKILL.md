---
name: kiro-native-parity-evidence
description: Investigate Kiro and Axiom/Pi native request parity using locate-first focused decompilation, version-bound evidence, platform-specific runtime observation, and non-repeating tests. Use when reverse-engineering Kiro authentication or transport, capturing CLI requests, reviewing Frida/Job/stdio fixtures, or resuming this parity investigation. Prevents treating mocks, TCP ownership, packet captures, or same answers as server equivalence.
compatibility: Cross-platform methods; macOS native CLI analysis uses Ghidra and platform-appropriate tools. Windows fixtures are historical only. Load installed Pi and REA skills for their tools.
---

# Kiro 原生对齐：证据与避坑工作法

## 用途与底线

这是可复用工作法，不是已实现的兼容客户端、运行授权或测试通过证明。**服务器可观察行为一致**与“接口可用”“答案一致”“去品牌”是不同验收。历史会话未完成最终对齐，不可因本 Skill 或交接完成而宣称技术目标完成。

- 接手具体会话，先读其最新交接、正式规格、任务树和当前步骤；**不要把历史子详情中的“正在运行”“等待授权”当现在**。与较新的结果/授权及现存文件核对。
- 不默认恢复 Failed/Abandoned 或耗尽预算的分支；已有授权不等于进程已经提权，也不授权读取无关 secret。
- 保持用户指定的原生直连路线，不偷偷换 CLI/ACP 桥接。不得复制 CLI 凭据绕过应用认证。
- 不通过删除用户 system/history/tools/security/auth/profile 或归一化动态差异制造“一致”。
- 本目录相对路径均相对本 `SKILL.md`。遇到对应阶段，按需读：
  - [从头到当前的案例与证据](references/case-lessons.md)
  - [macOS 原生 CLI 与免费工具路线](references/macos-native.md)
  - [Windows、Frida、资源生命周期历史清单](references/windows-runtime.md)
  - [本案例的交接入口](references/session-entry.md)

## 1. 先建立最小恢复卡

记录六项后再动手：**目标/当前焦点；源版本与SHA；已完成且仍适用的证据；失败和禁止重跑项；活动任务/进程与结果消费状态；唯一下一步**。

1. 历史搜索可用时查询精确对象与条件；不可用就读已保存原详情/归档/报告，明确检索失败，不能把目录关键词当答案。
2. 先确认所有权、输入、依赖和工作树。对仓库已有改动不 reset、不覆盖、不冒领；只测试本次影响范围。
3. 每项实验先写“要排除的假设、前提、成功判据、失败后动作、时间/字节/次数/资源上限”。不能排除新假设的重复模型调用不执行。
4. 启动前使用新 case namespace 和 CreateNew 门禁；成功/失败都占用，修复用新 case，不复用旧失败目录取绿。
5. 异步子任务必须用同一通知的 `taskId/resultId` 读取结果，核命令、exit、范围、文件SHA和关键证据；别把 queued 当完成。不要为进度轮询而重复委派。

## 2. 建立证据阶梯，禁止跨级推论

| 已取得的证据 | 能证明 | 不能据此声称 |
|---|---|---|
| 字符串、导入表、指令或反编译 | 该版本存在候选结构/代码；完整范围内的静态行为 | 此调用可达、当前模式执行、实际发送 |
| mock/VM/AST/offline test | 被测函数在该模型及输入下的行为 | Windows、Frida、权限、真实生命周期或网络一致 |
| attach/install/ready | 特定目标上的安装报告 | 请求 sender、hook命中、正文已经采到 |
| held handle + exact image + Job + TCP row | 指定采样窗内受控PID与候选连接的有限关联 | 完整树/完整四元组/排他socket/HTTP sender/服务器接收 |
| pcap/TLS握手 | 捕获接口和过滤器范围内的包及可见协商字段 | 加密HTTP正文、PID排他归属、全部请求、API retry |
| send前headers/body | 指定边界的构造输入 | 默认补头之后的wire、路由/代理后的服务器视图 |
| HTTP200/相同答案 | 本次有限功能结果 | 行为、上下文、请求数量和传输不可区分 |

每个结论都附版本、观察边界和未知项。不能把多个局部 PASS 拼成全链路证明；`received-only`必须一直保留，不可改称 drain。

## 3. 核心指导：先定位，再局部分析

**默认先定位，再局部反编译；不是先跑完整程序、失败后才缩小范围。** 不以“多导出一些C”为进度指标，也不因为换成Mac就恢复无界全局分析。

1. **先明确问题**：本轮只解决一个缺口，例如注册字段、省略规则、当前上下文来源或实际发送边界；写清可反驳的假设和所需证据。
2. **先绑定产物**：记录完整文件大小/SHA、发行版本、格式、架构及实际运行方式。Mach-O需区分架构slice和Rosetta；旧Windows地址/PE签名不能套Mac。
3. **先定位候选**：用字符串、导入/符号、交叉引用及已有调用链缩到少数候选；字符串命中只是线索，不宣称执行可达。
4. **确认范围后局部反编译**：先用同版本工具的小控制样本验证能力，再针对目标函数及必要的直接caller/callee。PE可依据`.pdata`辅助定界；Mach-O依据其函数起点/符号/unwind等实际元数据交叉核验，不能照搬PE边界算法。工具支持时使用noanalysis和定向DecompInterface，不启动不必要的全局预分析。
5. **验证而非只收伪代码**：核范围内bytes、逐指令覆盖、未解码gap、CFG及跳表边界；伪代码与ASM不符先修分析模型，不能把分析注释当原类型。
6. **够用就停**：已回答问题即进入下一项验证；扩展范围前说明新增证据目的。时间/内存/输出/函数数预算到达就保留有限结论，禁止同条件冷重试或无界std/allocator闭包。

- 全程序分析超时先检查原始错误、CPU/阶段和真实瓶颈；provider_timeout 不自动等于 OOM，调大预算不等于运行成功。只有明确需要且预算通过，才考虑更大范围。
- 给反编译器加类型/call-fixup时绑定目标指纹，标记为分析注释，不当原始符号或原生行为证据。
- 字符串、语法RIP引用、解码xref、调用可达、当前engine执行分开报告。未知CLI flag/布尔ABI不得“试着设一下”掩盖理解缺口。

## 4. 协议与应用修改按来源保真

- 认证按模式分别核：注册字段顺序、缺省与省略、scopes、锁内重读、刷新响应写回/未来调用。region不自动决定auth模式；相似social/device/External流程不能互套。
- 删除显式 UA 不等于最终没有 UA；核实际传输库补头。原OAuth注册历史不随代码修改倒退改变。
- 默认品牌生成可以按精确来源替换；用户同文、custom/force system、history、tools/results、路径、安全政策保留。切模和reload都必须测。
- provider单fetch不等session只请求一次。partial包括空增量、缓冲中thought/tool状态；有进展就不得按“无结果”重放。只重试明确无进展的允许错误。
- abortRetry、完整abort、resume、远端副作用和receipt幂等分开；未知工具副作用不能重执行，receipt不是服务器 exactly-once。
- agent `resources: []` 不等无有效上下文；核本地/全局/CWD/名称缺省/MCP/system继承。文档版本混用时先证明当前引擎支持字段。

## 5. 先用非模型夹具证明观察时机与安全

先确认平台。以下Job/HANDLE/NtResume/Wait0术语是[Windows历史契约](references/windows-runtime.md)，**不直接用于Mac**；Mac必须按[原生路线](references/macos-native.md)另证身份、创建时机、监督和终态，不能把进程组当Job。可复用的是所有权、原行为保真、迟到结果及失败单调原则。Windows案例关键规则：

1. 用新自有 Job、明确原创建句柄、精确路径与窄权限，不全局snapshot、不重新Open已结束PID。借句柄有效期由caller保证；查询类不控制/关闭它。
2. **不修改 ordinary API flags/args/output/retval/lastError**；不加 child gating、额外 Suspend/Resume，不把 APPEND 改 GENERIC_WRITE。高层flags0也不能写成Native flags0。
3. 若需要在自然启动前附着，在有证据的原自然 resume **onEnter** 做交接；CPW onLeave可能已太晚。初始人为暂停的自有夹具与被观察普通子创建分开记录。
4. JS callback 抛异常不是“阻止原API”的证明。无返回故障屏障需独立进程级 owner 兜底；同目标 JS timer/RPC、同控制主线程未来恢复均不够。
5. 所有获取到的句柄/SDK对象即刻有owner：先拒role冲突，登记失败局部Close；SDK对象在acquisition worker返回后、context退出/装callback前存固定lease，而非调用方拿到结果后才存。
6. SDK清理前必须 `Term==True` 且**非空完整held集合严格Wait0**。TermFalse即使全signal仍不能洗掉顺序错误。
7. EOF须真实关闭stdin；不要调用会写释放字节的 `.release()` 冒充EOF。未知stdout不落盘；已知fixture要比原始字节，不把Windows CRLF131B归一成LF129B。
8. 终态不能只靠good快照。进程内late callback需sticky failure；权威owner在原held Controller真正signal/exit0后复核。owner自己的deadline与最终提交也必须仲裁。candidate不是pass。

## 6. 测试与审计：纠正 oracle，不洗掉失败

- 被测源码测试期间不改；主改实现，独立任务只新建各自测试/报告。修实现后冻结新版本，重验受影响部分。
- 三种结果分开：**实现违规、harness/oracle错误、环境/工具启动失败**。入口exit0可能表示“成功复现漏洞”，不是安全通过；测试总结果和局部用例都保留。
- 修oracle须精确指出实际正确拒绝路径，保持同强度断言，不更改实现取巧；新报告绑定旧source/report/解释器/flags并逐项映射。
- 未变的通过测试沿用证据，不整套重跑。明确写 `188旧PASS沿用 + 1新执行 = 189覆盖`，不是189新跑，也不重复累计诊断用例。
- Python pure审计使用AST提取和独立namespace；不得修改共享真实ctypes；危险脚本只read/hash/AST/compile，不能import触发顶层运行。
- Strict JSON拒duplicate（含转义同键）、nonfinite、float/错exacttype、bool冒充int、超限/多余字段；完整schema与计数/集合关系同核。`all([])`不得用于完成门槛。
- 测试runner的合法本地IPC要精确白名单；不能无条件禁Socket把tsx pipe误判远端，也不能因此放开所有网络。

## 7. 防止“审计越做越大、主任务不动”

每轮只围绕下一项决策收集足够证据：有明确证据就停止该调查，不继续制造副本和计数。优先复用已冻结报告；新增索引保留pointer/行/byte/SHA和最小关键trace，不复制整份大record。完整原件保留，摘要不能删唯一副本。

- 只落白名单投影；raw native表/未知正文/凭据留内存。traceback也可能保留raw buffer；擦除计数不是readback，MemoryStream不是总bytecap。
- 以新路径保存、hash、RO并复核；RO不是ACL，前后SHA不证明原子加载image。重要TEMP源码应保存可核对的归档副本，但**归档可读不代表可直接执行**。
- 结束/压缩前更新记忆中的状态、结果消费和下一动作。交接、报告、工具可用等局部完成不关闭最终parity目标；新用户要求交接时停止后台实现，避免交接快照继续漂移。

## 离开本技能前的检查

- 当前动作是否推进一个明确缺口，而不是重跑已知失败或已过未变测试？
- 源版本、真实参数和原始字节是否保真？是否把未知归一成相等？
- 进程/句柄/Job是否自有、仍held、查询和控制是否分离？
- fault、timeout、late-result、empty collection、cleanup/export失败是否都不能产生可消费假pass？
- 报告是否明确真实执行次数、通过/沿用/诊断、instrumented/wire/server三层限制？
- 下一个Agent能否只读交接+manifest就知道该继续什么、绝不能做什么？
