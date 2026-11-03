# 两个helper完整Ghidra覆盖门禁未通过

父`run_helpers.py` **exit1 / failed_checks**；LLDB **exit0，6.898秒**，Ghidra **exit0，10.850秒**，均无timeout。只分析两个新的直接helper，没有重跑serializer或进入第四个函数。

- key候选464B：Ghidra **109条/436B**，15 CFG块27边；尾 **0x100c11588–0x100c115a3，28B**未解码。LLDB按完整范围有116条。
- string候选344B：Ghidra **79条/316B**，11 CFG块20边；尾 **0x100c10e58–0x100c10e73，28B**未解码。LLDB按完整范围有86条。

每条已解码指令机器码与LLDB一致、完整raw bytes与slice一致、反编译成功，源/目标/thin均未变化。失败同属入口seed不能发现无显式入口边的尾部，而非工具启动/程序运行错误；尾部可见free/_Unwind_Resume，但未解析LSDA，不能说完整异常CFG通过。

普通入口流明确key函数即时append逗号、双引号、处理后的key与`":`，返回同一buffer；string函数无length判零省略分支，无条件先后append双引号，调用`0x100c0fb8c`处理内容。仅能支持“存在时调用字符串writer、按调用顺序追加”；escape函数未分析，不声称完成所有转义、Some空串最终bytes或异常行为验证。

保留原failure与全部输出，不冷重试、不改原source/report，后续只对冻结证据做限定review。此限制不影响已完成的自有夹具能力测试结论，但禁止将本case计为整函数覆盖PASS。
