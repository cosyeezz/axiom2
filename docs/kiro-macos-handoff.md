# Kiro 原生对齐：macOS 接手与提交检查点

> **当前主线：macOS上分析macOS版Kiro CLI，以免费Ghidra为主；先定位，再局部分析。**
> 本页按用户新决定取代旧Windows交接中“先完成controller02/supervisor02”的下一步。它不改写旧实验，不代表最终parity完成，也不要求购买Hopper/IDA。

## 1. 接手顺序

1. 检出本次Kiro进展提交；先看`git status`，不覆盖其他未提交工作。本次仅提交经归属核定的Kiro差异，未提交的compression/REA/前台服务改动不属于Mac前置。
2. 读[避坑Skill](../.agents/skills/kiro-native-parity-evidence/SKILL.md)，重点第3节 **先定位，再局部分析**。
3. 读[Mac工具与门禁](../.agents/skills/kiro-native-parity-evidence/references/macos-native.md)与[Windows进展、限制及来源SHA](../.agents/skills/kiro-native-parity-evidence/references/windows-evidence.md)。
4. 核下面的目标与缺口。**第一项工作是绑定实际Mac产物并验证小型Mach-O分析，不是发模型请求，也不是移植Windows挂钩。**

本次Windows宿主没有Mac运行环境/产物，因此没有声称做过本次Mac实测。仓库较早的macOS2.33.1资料仅为历史参考，不能替代新基线。

## 2. 最终目标不变，平台基准改变

Axiom/Pi继续**原生直连**，不走CLI/ACP桥接；对比实际macOS官方Kiro CLI的服务器可观察行为。模型仍为精确`deepseek-3.2`，不静默切换。原Windows基准为2.35.1；新Mac版本必须实际记录，若不同明确版本迁移，不套旧SHA/VA/结论。

最终验收覆盖：
- 认证/注册/刷新、路由/profile及有效上下文来源；
- headers/body、字段原序/省略/类型，动态ID生成和跨轮关联；
- 文本、多轮、工具、图片、思考、流式结束；
- retry/abort/resume与未知副作用；
- HTTP/TLS/ALPN、连接复用、代理、DNS/网络与多场景实际比对。

HTTP200、相同答案、去品牌、mock/VM、TCP owner、pcap、文档和Git提交均不代替最终验收。缺证、差异或无法观察的服务端部分继续标未知，不能删除或归一化后称一致。

## 3. 此次保存了哪些工程进展

- `kiro-auth.ts`：两种OIDC身份的设备/PKCE注册按已知字段顺序构造，未来注册名使用`OAuth Client`，不回溯改旧OAuth记录。
- `kiro-catalog.ts`：fetch/reader独立abort-aware等待，迟到响应best-effort清理，不被卡住的cancel拖延；不把停止等待称底层资源全部释放。
- chat/catalog/profile去除显式Axiom UA；底层默认补头仍需真实观察。
- `axiom-prompt.ts`、`kiro-chat-protocol.ts`与Kiro compaction marker：只中性化本应用生成且已知来源的身份/框架；保用户system/custom/history/tool结果、安全全文与opaque扩展。
- 对应auth/catalog/chat/profile/images/interrupted/retry/prompt/compaction离线测试。retry测试验证Pi session预算，未凭空新增生产retry规则。
- Skill、Mac路线和历史证据摘要随Git携带。敏感凭据、未知正文、pcap、CLI/Frida大二进制、全量本机报告和Windows可执行夹具不入此次提交。

`compression-request.ts`和对应test是混合工作文件：提交只取Kiro marker及其测试，不纳入独立sampling/压缩恢复改动。新提交的验证范围见[提交验证记录](evidence/kiro-macos-transition/README.md)，不能把历史190覆盖说成本轮全跑。

## 4. Windows停点：保留但不继续执行

- 当前CLI完整明文仍缺；case10虽然CLI自然成功，Root/driver仍失败、NUL全0。TCP与TLS只能提供限定证据，wire的9帧opaque23不证明HTTP。
- 新采集分支02/05/08/10各1语义prompt，共4；不是全会话或物理API计数。09门禁失败0prompt但已占用。旧09/10不重跑，不发第5次无新假设请求。
- JS01/controller01永远Failed禁Native。JS02的74VM、IPC189（188沿用+1新）、02的38partial均非Native/非Mac验收。
- controller02仍`DRAFT_READY=False`，supervisor未写，**不以完成它为Mac迁移前置**。原Windows源/报告在冻结交接包保留；这里只携带方法、进度及原件指纹，不伪称完整原件已随Git搬迁。
- 无关前台服务分支Abandoned，不恢复安装器修复、测试、部署或重启；不import会在顶层触发模型的旧`kiro_current_deepseek_once.py`。

## 5. Mac执行计划与停止条件

### M1：身份和最小工具能力
记录macOS/CPU、CLI来源/版本、launcher/runtime关系、完整文件与slice SHA/bytes、签名、原生或Rosetta运行方式。选择Ghidra及兼容JDK，用小型自有Mach-O验证导入/解码/反编译。REA各封装的宿主支持单独核实，不以菜单显示证明可用。不必安装Hopper。

缺实际Mac环境或目标产物就停在此门禁；不能把Windows结果改标为Mac。

### M2：先定位，再局部分析
每次只解决一个问题，用字符串/导入/符号/xref缩小候选，核函数范围后再局部反编译必要caller/callee。优先认证、上下文构造、序列化和发送边界。核bytes/ASM/gap/CFG/跳表，使用当前格式的元数据而非PE `.pdata`。足够回答就停；超时不等OOM，不恢复旧无界全局分析/std闭包。

### M3：Mac专用非模型观察
以实际调用路径设计身份、进程监督、真EOF、输出总cap、异常/迟到资源/终态仲裁。进程组不等Job；POSIX spawn不等NtResume；Windows权限/结构尺寸/CRLF不继承。先用已知fake输入输出证明限定安全和观察时机，再确定官方有限采集方案。需要改变官方签名或系统保护的方案不能当原生未改基线，不默认关闭SIP。

### M4：新官方基线及Axiom逐项对照
门禁满足后建立新的Mac case namespace和一次性输出。有效context必须核selected agent/local/global/CWD/resources/MCP/system，不以resources[]称空。分别记录明文构造边界、未插桩wire和响应/服务器证据，差异逐项修复、只重验受影响范围。先文本与流式，再多轮/工具/图片/思考/取消恢复，不以反复空发代定位。

## 6. 工具、权限与可携带性

- 免费主线：Ghidra/JDK；辅助`file/otool/nm/lipo/codesign`，动态按需LLDB/Frida。具体可用性尚未在目标Mac验证。
- Wireshark/TShark/dumpcap或tcpdump；Mac libpcap/BPF后端，不用Npcap。接口/路由重新核定；普通HTTPS包不含明文。
- 不复制CLI凭据到Axiom、不导Keychain/TLS keys；使用正常认证。最高授权不等系统已提权，不扩展到他人进程/数据或全局CA/代理/防火墙修改。
- `.agents/skills/kiro-native-parity-evidence`可直接阅读；Axiom/Pi实际发现/同名优先级需核。不要为了加载文档重启Abandoned服务或改生产安全策略。
- 本次只做本地提交；若尚未推送，Mac需通过用户选定的仓库远端或受控Git传输取得该提交，不假称远端已同步。
