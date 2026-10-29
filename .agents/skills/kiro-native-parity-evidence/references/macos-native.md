# macOS 原生 Kiro CLI：免费工具与门禁

## 明确目标，不混平台

当前用户选择在macOS上分析 **macOS版Kiro CLI**，继续与Axiom/Pi原生直连逐项比对。不是在Mac上反编译Windows EXE，也不是让Mac模拟Windows客户端指纹。Windows观察是历史线索，Mac尚无本次新基线；此前仓库的macOS2.33.1材料同样不能冒充当前目标。

不使用付费Hopper作为主线或前置依赖，也不要求购买IDA。静态分析首选 **Ghidra + 与其版本匹配的JDK**；格式/符号/签名辅助可用macOS的`file`、`otool`、`nm`、`lipo`、`codesign`。动态调试按需用LLDB，插桩按需评估Frida；不要为了“工具齐全”先全部安装。

## 第一门禁：绑定实际Mac产物

先确认宿主macOS版本、CPU、工具自身架构，以及官方CLI实际运行架构（原生ARM64/x86_64/Rosetta）。记录官方下载来源/包版本、launcher与实际执行文件关系、完整bytes/SHA、Mach-O各slice和签名状态。Universal文件与提取slice各自有SHA，不能混用。版本/签名/地址只说明对应产物身份，不证明原子loaded image。

- 不执行安装脚本来代替只读检查；安装/配置遵从当前用户授权范围。
- 不读取或搬运Windows CLI认证缓存、Keychain导出或secret来完成迁移；CLI和Axiom各用正常授权链。
- 模型仍为`deepseek-3.2`，不能静默换模型；Mac官方版本若不是原Windows2.35.1，明确记录新版本和差异。不存在目标/模型时保留阻塞，不伪造匹配。

## 核心指导：先定位，再局部分析

1. 每次只定义一个问题和足够的证据，例如认证刷新、有效context、某段序列化或发送边界。
2. 字符串/导入/符号/xref定位少量候选；然后核函数边界及必要caller/callee，不从全程序反编译开始。
3. 先小型自有Mach-O验证当前Ghidra/JDK/架构能导入、解码和反编译，再在目标上定向分析。
4. 用Mach-O实际元数据、符号、unwind及指令交叉核范围；Windows `.pdata`/旧VA/字节签名不可移植。
5. 核完整bytes、ASM/gap/CFG/跳表，不因有C输出就认定正确；反编译器类型修补只是分析模型。
6. 预算到限或证据足够即停止；只有新增明确假设才扩展。Rust/C++优化、泛型/异步状态机等复杂性不会因换OS消失。

## 第二门禁：先非模型观察，再受控采集

根据实际Mac调用链设计观察点，而不是把`CreateProcessW/NtResumeThread`改名为`posix_spawn`就运行。进程组/信号不等于Windows Job kill-on-close。至少单独证明：

- 原创建资源的所有权、身份与PID复用防护；不全局扫进程/重开旧PID补证。
- 普通API参数、返回值和执行行为不改；插桩与未插桩证据分别记录。
- 真EOF、输出总量上限、已知fake输入输出原始字节保真；不沿用Windows CRLF131B为Mac标准。
- 独立监督/截止时间、迟到SDK对象登记、非空完整清理集合、故障单调、最终发布与deadline仲裁。
- SIP/Hardened Runtime/签名/调试权限按实际返回判断；不默认关SIP、安全软件或重签官方目标来“通过”。若必须修改目标，另列为不同产物，不能当未修改官方基线。

当前Windows controller01/JS01永远禁Native；controller02仍DRAFT_READY=False。**不以完成Windows supervisor02为Mac迁移前置，不在Mac执行归档Windows脚本。**

## 抓包与集成边界

Wireshark/TShark/dumpcap可在macOS使用，底层为libpcap/BPF，不安装Windows Npcap。按实际接口和路由选择抓包设备；`en0/lo0/utun*`只是候选，不能假定出站接口。tcpdump可做轻量辅助。

- TCP/pcap不自动证明HTTP sender/正文/服务器接收；TLS1.3 opaque23不等HTTP，重传不等API retry。
- 被动wire与明文探针/MITM分轨；代理会改变TLS/ALPN/连接，不能拿其结果验证原生直连指纹。
- 不改全局CA/代理/防火墙，不自动导出TLS密钥，不停止他人抓包。
- 工具支持Mac不等REA每个封装都支持Mac；先读当前安装版本契约。PTY、LLDB、Frida和pcap封装的宿主支持范围各不相同，不能仅因MCP列出名字就宣称可用。

最后仍需真实Axiom出站、认证/上下文/原序/动态关联、工具/图片/思考、流式/重试/取消/恢复、HTTP/TLS/ALPN/代理/连接和多场景逐项闭环。文档、静态或fake成功都不关闭最终目标。
