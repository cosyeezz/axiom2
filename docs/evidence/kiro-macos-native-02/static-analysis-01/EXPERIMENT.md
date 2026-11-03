# S1：精确请求serializer的局部分析

继承[问题与初始预算](../static-locate-01/EXPERIMENT.md)。定位扫描exit0：nlist无所选符号；GenerateAssistantResponseRequestSerializer名位于__LINKEDIT。追加一次静态dyld export-trie解析exit0（20851节点/13457终结项，0.299秒），找到精确 `SerializeRequest::serialize_input`，地址 **0x1007d6bb4**。其导出地址与LC_FUNCTION_STARTS起点一致，下一个起点 **0x1007d7ef0**，完整范围 **4924B**。

为核完整函数而非截断，**只把本函数byte预算从4096提高到8192**；不是扩大全局调用闭包或分析函数数。新`FocusedRequest.java`从已测`../FocusedMachO.java`复制，只改类名与范围上限，原测试源不改；运行前核变更仅这两项。仍只反编译该函数一次，最多20秒decompiler，启动/导入deadline300秒、heap8GiB、CPU4，-noanalysis+禁incremental，无自动callee分析。必要的至多2个直接helper须得到新明确问题再分析。

ARM64 thin slice仅提取到本case自有TEMP，先后核SHA匹配environment.json，不执行、不重签、不写repo二进制。全函数bytes与原slice比对；LLDB只在`--no-lldbinit`批模式离线创建image并反汇编该地址范围，**不launch、不attach**，用于与Ghidra ASM核对。记录完整gap/CFG，若出现未解码尾部/不可达段，不忽略、不归一化。

成功判据：直接观察serializer对profileArn指针/长度或判别值的分支、字段key写入及顶层调用顺序；伪代码结合ASM与literal地址确认。若仅是候选或需helper，报告有限结论，不宣称当前模式实际执行、请求发送或服务端接收。0模型请求。V3提示开关另待核，不将当前静态候选冒充启用后路径。
