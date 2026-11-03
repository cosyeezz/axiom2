# V3本机状态与只读契约：当前进展

> **后续新版结果：** [source04](../v3-kas-source-04/SUMMARY.md)新native精确len22000545，完整frame/tar通过；三public成员与旧实际bytes相同并已核旧只读归档可取，因此可限定复用旧双API/transport/init源码审计，不能迁移旧native地址或当前active分支。[converter新证据](../v3-key-settings-review-01/SUMMARY.md)已绑定key73=`chat.agentEngine`、key35=`chat.ui`；flags/三map来源/session effective仍未知。此前source03旧长度真实失败保留，不追认成功。新版CLI/JS尚未执行，0模型，门禁未过。

> **版本边界更新：** 下文getter/局部native/KAS源码研究绑定旧冻结**2.35.1**。t11026/r11170检测到实时chat改变，旧函数表断言失败并立即停止，没有分析两个新helper；[原失败](../v3-engine-key-default-01-failure/verification.json)完整保留。随后[新静态重绑](../identity-rebind-01/verification.json)一次exit0：公开bundle metadata现**2.35.2/build20261029.011827**；当前launcher/chat全SHA与新fat/slice/UUID/section表已重读/readback，未运行新版CLI或推理。新身份不自动迁移旧VA/实现结论；旧研究有效但不能冒称新版。

## 已确认，不再等待用户

用户已确认看见的就是V2→V3提示，并明确要求自主推进、不再提问。此前[V3离线报告](../v3-locate-02/REVIEW.md)中“等待确认”的文字是当时快照，**不再是当前阻塞**。

本机非secret设置的[单key最小投影](../v3-user-state-01/verification.json)实际exit0，`chat.agentEngine`存在，**storedEngine=v3**。只打开已证`/Users/dane/.kiro/settings/cli.json`一次，只保存该白名单枚举；没有执行真实HOME的CLI、读取登录DB/Keychain/凭据、保存其他设置或改开关。**stored不是当前session effective engine，也不证明是否已经迁移agent格式**；后续受控启动应绑定选择及对应KAS路径，而非继续假定旧native serializer就是当前sender。

## Getter和路径的有限验证

| 实验 | 实际结果 | 可用结论 |
|---|---|---|
| [空HOME且禁全部写](../v3-settings-fixture-01/FAILURE.md) | 父/子exit1；0.318s；stdout0/stderr44B，离线固定错误hash精确匹配EPERM | 被拒调用未知，不能推断用户未设置/默认v2；保留失败不重跑 |
| [两个已知JSON值](../v3-settings-fixture-02/RESULT.md) | 父exit0；两子exit0，各JSON string `v2`/`v3`，5B；setting SHA不变 | HOME/_KIRO_HOME同源下getter读取随值变化；允许自有TEMP初始化，非零磁盘写 |
| [HOME默认及冲突override](../v3-settings-fixture-03/FAILURE.md) | 父exit1；HOME-only v3成功；冲突override预期v2实际仍v3，两个子均exit0 | 默认HOME候选路径受支持；override支配假设被反例否定，不能改oracle洗绿 |
| [真实单key投影](../v3-user-state-01/verification.json) | 父exit0；stored v3；0 CLI执行/0 auth存储读/0配置写 | 只证明stored setting，不是effective engine |

隔离getter全程deny network/真实HOME读/securityd，settings文件写入被拒。02/03的自有SQLite及锁仅盘点路径/大小，不读正文。独立只读审计`t11025/r11029`核3份source SHA、5条getter结果、fixture与5B输出SHA，共59检查/exit0，不重新执行CLI；不包括随后真实投影。审计特别保留进程组不等整树监督、无系统调用审计和逐case loaded-image原子绑定等限制。

## V3/KAS离线定位，不误用旧实现

独立`t11001/r11007,r11013,r11036`在当前已绑定chat ARM64产物中定向定位：

- 全fileoffset `312732725`与`339239487`的zstd frame，其各64KiB解压前缀都是ARM64 `MH_EXECUTE`；后者有Bun/JSC section标记。FCS unknown、window8MiB、未到帧末、不证明完整资源/校验或运行可达。**不是可以直接取作server JS的tar包**，也未排除native文件后部附带资产。
- `289134287`与`360802064`的gzip各64KiB前缀为有效tar，前12个header checksum有效，含`models/`、`contexts.json`、PAX/AppleDouble，倾向文档检索索引。未验证gzip EOF/CRC，不能排除后部JS，不盲解压当KAS源码。
- `339239257/339239269/339239274`有`node_modules`/`@kiro`/`acp-server.js`路径组件，`KIRO_KAS_SERVER_PATH`及`embedded_tui.rs`解包逻辑是定位线索，不证明完整路径拼接或实际执行。

独立`t11026/r11035`的export trie/函数起点限定研究只找到`AgentEngine as ValueEnum::to_possible_value`，VA `0x10213b7d0`、344B，**不是effective-engine选择函数**。flags/stored/default完整优先级尚未恢复。邻近8MiB代码的一个xref命中实际是别的文案，已排除，不当engine候选。

### 真正KAS bundle已独立定址

[定向xref](../v3-resource-xref-01/locations.json)把资源逻辑缩至单函数`0x101631f3c–0x101634f40`。[限定LLDB ASM](../v3-resource-disasm-01/verification.json)一次exit0，完整函数12292B，无launch/attach。独立`t11001/r11071`及主侧冻结ASM回读确认`0x101632fe8/2fec`构造资源ptr、`2ff4/2ff8`构造len：

- VA **0x104832e96**，ARM64 sliceoff **75706006**；全fileoff **290729622**，len **22001675 / 0x014fb80b**，end-exclusive **312731297**。
- ptr/len先存`[x19+0x280/+0x288]`，后转存`+0xc0/+0xc8`与`+0x150/+0x158`。callee候选`0x101635798`，call PC`0x1016342d0`；未分析callee完整语义/可达性，不称实际运行。
- [精确头/字面量](../v3-kas-header-01/header.json)主侧一次143B只读exit0，新slice头为zstd；补`agent`/`dist`/`server`真实字面量，与冻结Path::_join指令对应，静态相对入口为 **`node_modules/@kiro/agent/dist/server/acp-server.js`**。
- [独立有界prefix](../v3-kas-prefix-01/RESULT.md)，`t11001/r11077`：只读压缩32768B、decoder消耗17404B，解压65536B/2call，exit0。8MiB window、checksum flag1、FCSunknown；前12个tar/PAX header校验有效，包含node_modules依赖，未到@kiro/agent。**未到frame EOF，尚未核完整checksum**；不将tar局部校验代全frame。此前两个native frame的发现不是全程序magic穷举，不能排除这个第三个独立zstd。

### Public server bundle已取得且完整帧已核

[源码提取01](../v3-kas-source-01/FAILURE.md)在19项自有合成测试通过后，一次官方资源读取真实exit1/0.211s，`file-cap`；8MiB单文件预算不足以取得本次最终发现的15MiB entry。原失败、source、CreateNew门禁和partial输出全部保留，不改oracle或重跑01。

[新精确提取02](../v3-kas-source-02/EXPERIMENT.md)只白名单3个public文件，单file64MiB/合计128MiB；其余window16MiB/总解压512MiB/成员40000等不放宽。独立`t11095/r11110`先AST核仅selector/main预算/TEMP prefix三处变化，再19旧合成用例重执行+2新selector用例=21通过；主侧已核源码SHA/脚本/[结果](../v3-kas-source-02/synthetic-01/results.json)。64/128MiB预算只做AST核，没有生成该体积测试数据。

02主侧随后一次实际exit0/0.528s，[manifest](../v3-kas-source-02/verification.json)：

- 同FD完整chat实际SHA与已绑定产物一致；压缩读取/消费均 **22001675B**，真实 **frame EOF/checksum完成且没有压缩trailing**。
- 完整解压 **197488640B**，tar实际847个成员，仅选3文件共15030951B。完整压缩SHA `c622372e59d8bf6f2fd84fda092c5a441b38922f4975326af7de6b4b5572f4ff`；解压SHA `25a08dd6ae0fab593f7b75ba6327bc08c6797c2dac3e02e70f84028bd32279ab`。
- entry **acp-server.js=15025207B / SHA bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1**；另为externals JSON465B、package JSON5279B。包内自述 **@kiro/agent0.66.70**，不是CLI外层版本号2.35.1。
- 已存[public source只读归档](../v3-kas-source-02/selected-public-source.tar.gz)并对全部3成员重新读回核size/SHA/[archive verification](../v3-kas-source-02/archive-verification.json)：4097039B，SHA `0ab5cb92dae244ffb20577d7767baee9706c5f4605b615c279300f4b01cae267`。归档可读不代表可直接执行；未运行成员或安装依赖。
- preservation同时重新实际hash官方launcher，完整SHA `c18e08c40d5aa9d143d605e35e7f8606b6a33316a2fa29c2ac0e4188708e0039`/73449264B匹配，补当前on-disk身份；**不是此前每次getter的原子loaded-image证明**。

目前只读定位真正sender/入口/model条件。完整解包和代码存在仍不证明effective engine、实际sender可达或服务器行为。**不能把Axiom换成CLI/ACP桥接**；官方内部KAS/ACP不改变Axiom原生直连约束。

## 完整静态门禁为什么没过，如何补，与最终目的的关系

[S1](../static-review-01/SUMMARY.md)的serializer尾384B与key/string各28B未被Ghidra普通入口覆盖，且LSDA/完整异常CFG及escape细节未知。这是真覆盖缺口，不是已证请求错误。要升级**该静态门禁**需另设新假设，定向解析异常入口/LSDA、核尾部指令与必要的escape语义，再独立核对；不能修改旧failed_checks或冷重试刷绿。

这不自动阻止最终目标，但S1局部成功也不能替代最终目标。尤其本机stored=v3，新引擎可能不走旧serializer；当前优先绑定实际V3路径和Mac非模型观察，而不是无证据价值地扩大旧std/allocator闭包。即使静态全绿，仍需实际请求和传输/服务器观察证据。

## 未完成的验收

当前累计本轮新getter5次（01一次+02两次+03两次）、之前隔离help一次；此计数不含较早环境version命令，也不把只读审计当目标执行。**真实模型请求仍0**、应用源码改动0、用户设置改动0。

还需完成实际engine/创建路径绑定、对应Mac非模型观察时机/所有权/独立deadline/终态门禁，然后才能进行精确`deepseek-3.2`受控基线、Axiom原生出站差异修复及多场景/传输核验。未取得这些证据，不能宣称服务器可观察行为已不可区分；没有要求用户再次确认。
