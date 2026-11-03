# 单个KAS资源函数的离线反汇编

前置：新[xref定位](../v3-resource-xref-01/locations.json)在同一LC_FUNCTION_STARTS函数`0x101631f3c–0x101634f3f`（12292B）找到server override、第一zstd起点与acp-server.js组件的ADRP+ADD候选。当前具体问题仅是传入解包/资源创建的pointer、长度、压缩类型和目标路径组件，不能把第一个native前缀等同完整包。

使用已保存、从不执行的同SHA chat ARM64 thin，LLDB `--no-lldbinit --batch`仅`target create`和该一个范围`disassemble --bytes`。预算1个函数（<=16384B），一次LLDB<=25秒，每个输出文件hard cap1MiB，结果还拒绝stderr超过64KiB（这是事后门槛，不另称OS hard cap）；CPU20秒。无launch/attach/模型/网络/HOME配置读，无Ghidra全程序分析。只保存公开目标ASM及命令/exit/hash，不声称数据流/完整CFG/运行可达已经通过。
