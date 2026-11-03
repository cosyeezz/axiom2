# Mac局部分析能力门禁01

假设：现有Ghidra12.1.4+JDK21能在原生arm64 Mac上导入小型Mach-O，关闭自动分析后，仅对已知符号范围解码及反编译。

成功判据：Clang构建并在禁止网络的sandbox内执行，自有fixture stdout逐字节为`fixture:38,2,81\n`、exit0；nm定位parity_select至main起点的完整函数范围；Ghidra日志标识-noanalysis，导入成功；定向函数所有bytes均被指令覆盖、gap=0、CFG可导出、局部C包含三支结果。核otool ASM与Ghidra bytes/ASM一致。不依赖全程序analyzer。

预算：本case一次构建、一次执行、一次Ghidra调用；外部deadline180秒、Java heap2GiB、CPU2；只反编译parity_select一个函数、最多4096bytes、单函数20秒。失败保留case并用改变假设或修正探针后的新namespace；不在原路径冷重试。0真实模型请求，不碰官方目标运行时或凭据。

创建源文件后测试期间冻结；Ghidra项目和二进制位于独立/tmp工作目录，不提交二进制。报告保留源与被测二进制SHA和命令exit。
