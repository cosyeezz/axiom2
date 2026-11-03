# Mac 环境门禁与官方产物身份

> **Mac监督原语最新证据：** [公开XNU同pin合同](mac-supervision-primitives-05/SUMMARY.md)、[当前host零调用prefix](mac-supervision-primitives-06/SUMMARY.md)、[精确hosttag完整404](mac-supervision-primitives-07/SUMMARY.md)与[shipped launchd快照](mac-supervision-primitives-08/SUMMARY.md)分层保留；publicpin不是hostkernel、privileged-coalition不等root、terminate不等kill。[09纯定位失败](mac-supervision-primitives-09/SUMMARY.md)保留，替代[10 bootout直接函数](mac-supervision-primitives-10/SUMMARY.md)564B/141ASM无直接terminate；[11全text直接caller](mac-supervision-primitives-11/SUMMARY.md)是44B flags0 wrapper，[12查该wrapper直接caller](mac-supervision-primitives-12/SUMMARY.md)候选0，均不排除间接/data路径。[13工具shim失败](mac-supervision-primitives-13/SUMMARY.md)实际exit72并请求安装、UI是否出现未观测，未批准安装、不重试。[14纯格式门禁失败](mac-supervision-primitives-14/SUMMARY.md)保留321PASS/4FAIL、未main；[15收窄合同后](mac-supervision-primitives-15/SUMMARY.md)原325与独立focused通过，唯一main扫描2396个format12 chained entries，精确wrapper指针refs0，不排address-of/export/relative表或其他间接路径。[16代码address-of](mac-supervision-primitives-16/SUMMARY.md)定位1处ADRP+ADD，[17唯一包含函数](mac-supervision-primitives-17/SUMMARY.md)104B/26word显示signedwrapper作为x4传给139b8，尚未证callee调用或权限。Mac M3/完整后代drain与最终parity未过，0控制API/0真实模型请求。

> **新增自有HTTP局部校准：** [02原API与loopback保真](observer-http-fixture-02/SUMMARY.md)通过原17+新增13pure及10对HTTP/HTTPS原bytes，8不可变API与10header匹配，2Buffer负例明确API≠server receipt；[03真实失败/负例](observer-http-fixture-03/SUMMARY.md)保留raw JSON深度跨版差异与FD注入器失败；[04严格consumer](observer-http-fixture-04/SUMMARY.md)定义16层并通过双Python原270与独立78边界，全部已主核/永久保全。均不是官方Node、完整后代监督、Mac M3或最终parity，仍0真实模型请求。

> **新版后续已证：** [2.35.2 KAS完整源码](v3-kas-source-04/SUMMARY.md)按新native精确长度完整EOF/checksum通过，三public成员与旧逐字相同，可限定复用旧双API/Node HTTP/1.1静态审计；不是整个CLI/Node或实际选路相同。[新版setting键](v3-key-settings-review-01/SUMMARY.md)已绑定key73=`chat.agentEngine`、key35=`chat.ui`，当前session effective仍未知。新版静态身份/本地签名/readback见[阶段交付](identity-rebind-01/SUMMARY.md)；0模型与未过Mac观察门禁不变。

> **当前产物已变更，下面2.35.1表为旧冻结证据，不是新版身份。** 研究中检测到实时文件漂移，立即停止旧偏移分析；新[身份重绑实验](identity-rebind-01/EXPERIMENT.md)已一次静态快照/readback成功，公开bundle metadata为**2.35.2/build20261029.011827**，未执行新版CLI。新版chat完整SHA `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`；详见[重新解析的当前manifest](identity-rebind-01/verification.json)。签名、loaded image、当前engine/真实请求仍分开验证，不沿用旧VA/offset；0真实模型请求不变。

**结论：本轮离线静态分析环境门禁通过；不是运行时采集或最终 parity 通过。** 真实模型请求0次，未读取/导出凭据、Keychain secret或TLS keys，未修改官方目标、系统保护、全局网络策略或既有应用源码。

## 恢复及宿主

- 指定交接提交 `033775d8fae20785ddd52c1e1cf6ba308b6908e6` 存在且主题匹配；当前HEAD `7989ab6f884e120a6b5c1fa504254e46f04e2b89`。原工作树大量改动保留，不reset/clean/stage/commit。
- macOS **26.6.2 (25G83)**，ARM64；`sysctl.proc_translated=0`。本轮CLI版本命令使用 `sandbox-exec (deny network*) /usr/bin/arch -arm64`，成功exit0；不据此推断之前用户会话或完整launcher→chat实际运行链。
- 当前用户uid501，不是已提权root；静态阶段不需要提权。用户授权可自行增加预算，但实验仍有明确范围和deadline。

## 官方目标

`~/.local/bin/kiro-cli` 和 `kiro-cli-chat` 分别symlink到 `/Applications/Kiro CLI.app/Contents/MacOS/` 下同名Mach-O。两者 `--version` 均为 **2.35.1**；bundle版本 **20261027.214411**。它们不是Windows EXE，也不是同一文件。

| 产物 | 完整bytes | 完整SHA256 | ARM64 slice bytes | ARM64 slice SHA256 |
|---|---:|---|---:|---|
| kiro-cli | 73449264 | c18e08c40d5aa9d143d605e35e7f8606b6a33316a2fa29c2ac0e4188708e0039 | 36044592 | fd43bcfeeaa5acf32e15809ad630685d0c0ce7a5a404a183dcfcc9280bfe5bcf |
| kiro-cli-chat | 413051984 | d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1 | 198028368 | 558b27343a899ea123db9f9edb52c6bb2f65d712fe4c137919feab490bf620f7 |

两者均Universal x86_64+arm64，各slice offset/size/SHA与完整原始命令见[environment.json](environment.json)。`codesign --verify --strict --verbose=2`均exit0；display为AMZN Mobile LLC、Team `94KV3E626L`、Hardened Runtime；bundle有stapled notarization ticket。签名/版本与本机安装位置支持身份，**原始下载URL/安装渠道元数据缺失，仍未知**；不将签名自述等同完整供应链核验。前后完整SHA一致，不证明原子loaded image或当前HTTP sender。

## 工具与实际能力

- 已有 **Ghidra12.1.4** `/opt/homebrew/opt/ghidra/libexec/support/analyzeHeadless` 和 **JDK21.0.12.1 ARM64**。Ghidra要求Java≥21；默认PATH Java8不兼容，本次仅测试进程显式JAVA_HOME/PATH，不改全局或安装。Java26亦已装，本次未选。
- 已有Apple Clang14.0.3、SDK、file/otool/nm/lipo/codesign；LLDB1403、tcpdump4.99.1/libpcap1.10.1已能报告版本，**动态调试/抓包权限与清理未验证**。
- Pi实际依赖 **1.4.0**（不是历史Windows1.1.0）；已读当前Skill和README。`deepseek-3.2`是固定目标模型，用户声明已提供；**本阶段不请求catalog或模型，实时可用性未实测，不静默替换**。调查助手宿主模型不充当被测模型。
- REA安装 **6.8.0**。独立只读审查 `t10891/r10894`，主复核 `dist/ghidra/GhidraLauncher.js:500–577`：默认导入会auto-analysis，无公开noanalysis定向入口；本轮不用 `open_binary`，直连底层Ghidra `-noanalysis`。不是Ghidra能力缺失。
- 当前REA的LLDB/PTY有Mac实现，未执行；Frida可选依赖未验证且无frida CLI。REA两种pcap封装有Linux或Linux/Windows宿主门禁，**不支持Mac**（主核 `TsharkCaptureProvider.js:32/80` 与 `pcapAnalysis.js:5/6`），不能安装tshark后假称可用。tshark/dumpcap当前缺失；静态阶段不需要，不预装整套工具。

## 小型自有Mach-O测试

[实验假设和预算](fixture-01/EXPERIMENT.md)、[固定源码](fixture-01/fixture.c)、[定向Ghidra脚本](FocusedMachO.java)。构建/运行各一次、Ghidra一次（5.915秒，2GiB，CPU2），子命令均exit0，无timeout：

- fixture为ARM64 Mach-O，33476B/SHA `727ead039de305a4a20092ab56825a16490dc3b2ea78787fb2db20d092ea150a`；sandbox禁网络执行stdout逐字节 `fixture:38,2,81\n`。
- `parity_select` 由nm定位到 `0x100003e24–0x100003e9f`；**124/124B、31条指令、0 gap、8 CFG块**。bytes匹配原文件，指令地址及ASM匹配otool；直接DecompInterface输出三条正确分支。只分析该函数，禁incremental code analysis，无全程序analyzer；导入器仍会解析元数据/fixups，不能称完全没有loader分析。反编译推断uint不证明恢复原C类型。
- 原runner总exit **1**，唯一失败是旧 `AARCH64:LE:64:v8A` 期望；实际安装的正确语言为 `AARCH64:LE:64:AppleSilicon`。保留[原失败报告](fixture-01/verification.json)，未改被测脚本或重跑已过执行。
- [新oracle复核](fixture-review-02/verification.json) exit **0**，绑定当前 `AppleSilicon.ldefs` 的确切AARCH64/little/64定义，并重新核冻结hash、ASM/CFG/C；**新增Ghidra执行0次、fixture执行0次**。独立只读复核 `t10901/r10903`同意oracle错误判断，并逐条比对31条ASM、CFG9条边及源码hash。结果仅限自有离线样本。
- 更早环境探针01因系统Python无os.getxattr失败，原件保存在[失败说明](../kiro-macos-native-01/FAILURE.md)。probe02改用原生xattr，exit0。失败不抹除，不计为CLI或Ghidra失败。

## 官方局部静态结果 S1

已按先定位后局部分析完成`profileArn`缺省与相对字段顺序的[限定静态交付](static-review-01/SUMMARY.md)，状态为 **`supported_static_entry_flow_with_known_gaps`**，不是整函数覆盖或最终parity通过。

- dyld export trie与LC_FUNCTION_STARTS交叉绑定精确serializer **0x1007d6bb4–0x1007d7eef（4924B）**；只为完整该函数把byte预算4096提高8192，另核key/string两个必要直接helper，不扩展全局/std闭包。
- 普通入口成功流先处理`conversationState`，再按profile首word是否为 **0x8000000000000000**决定省略`profileArn`，非缺省调用key及字符串writer；不是字符串length非零判断。key helper即时追加到同buffer，字段先后有实际追加顺序意义。
- 仍未证明完整Rust类型映射、`Some(空串)`最终bytes、escape helper或当前V3/engine实际可达。Axiom默认两个字段顺序相符只限无hook且profile为非空字符串的构造路径；不代表完整正文/出站一致，不据此修改用户上下文或生产协议。
- 两次headless导入/3个唯一函数反编译、两次LLDB离线session，子工具均exit0无timeout；**两个capture父runner均exit1/failed_checks**。Ghidra从普通入口未发现serializer尾384B和两个helper各28B；原失败报告保留。LLDB按范围线性覆盖全bytes，不补足异常CFG；LSDA未解析，不把cleanup候选称不可达。详见[结论与原始证据索引](static-review-01/SUMMARY.md)、[指纹manifest](static-review-01/verification.json)。

## 下一门禁与客户端V3配置

已继续完成[V3离线定位](v3-locate-02/REVIEW.md)：当前官方2.35.1产物确有“`You're using Kiro CLI V2. Switch to V3 today.`”、`chat.agentEngine`、单次`--v3`及“切换并升级配置”提示；另有**已在V3但agent配置仍是V2格式**的升级提示，不能混同。236个ASCII候选无截断、独立有限窗口审计已消费；内置`v2`默认文案不是本机生效值。原AS硬限启动失败保留，替代流式扫描不是重复旧尝试。

用户最新已确认就是该提示，要求自主推进、不要再提问；**不再以等用户截图或确认作为阻塞**。[最新状态及契约交付](v3-state-review-01/SUMMARY.md)：先在自有隔离HOME做5次单key getter，保留EPERM失败与override冲突反例，成功验证HOME-only设置路径和值敏感性；再不启动真实HOME CLI，仅打开已证非secret`~/.kiro/settings/cli.json`一次，白名单投影得到 **stored `chat.agentEngine=v3`**。没有读取登录DB/Keychain/凭据或修改设置；stored不等effective，agent格式迁移状态仍未知。正在按V3/KAS对应启动与资源边界继续，不沿用旧native serializer作为当前sender结论，也不将Axiom改成CLI/ACP桥接。原help和V3离线报告保留为当时范围的证据，最新进展见新交付。

尚未验证完整launcher到runtime启动链、有效上下文、观察时机/所有权/超时清理、真实`deepseek-3.2`可用性、明文或wire。后续运行时必须另过与实际引擎对应的Mac非模型夹具；本报告不授权提前模型调用。
