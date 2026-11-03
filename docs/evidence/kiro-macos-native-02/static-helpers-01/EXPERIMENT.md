# S1必要的两个直接helper

继承[单一问题](../static-locate-01/EXPERIMENT.md)。不重跑完整serializer，不修写原failed_checks。主函数普通入口流在写profileArn时调用`0x100c113d4`再`0x100c10d1c`；必须确认前者是**即时追加key而非暂存排序**，后者是**JSON字符串写入、长度0仍写引号**，才可解释顺序与Some空串。

两者均由当前LC_FUNCTION_STARTS精确匹配：key候选 **0x100c113d4–0x100c115a3，464B**；string候选 **0x100c10d1c–0x100c10e73，344B**。至此本问题总计3个唯一函数，不递归进入内部escape/allocator实现，不扩展全程序。若需更深复杂路径，留未知停止。

复用上一case自有TEMP thin slice但前后核其SHA；仍不执行目标。LLDB单次offline session只反汇编这两个新范围，Ghidra单次-noanalysis导入+两次postScript，直接复用未改的已测FocusedMachO.java（每函数≤4096B/20秒）。8GiB/CPU4、导入deadline300秒。核bytes、逐指令地址/word、gap、CFG；脚本/输入前后hash相同。原serializer尾384B未由Ghidra解码、LSDA未解析的限制继续保留。本case成功不覆盖该失败。
