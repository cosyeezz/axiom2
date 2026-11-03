# 有限入口流结果，完整Ghidra覆盖门禁未通过

`run_analysis.py`父进程 **exit1 / failed_checks**。LLDB离线反汇编与Ghidra headless均 **exit0、无timeout**；Ghidra单函数反编译成功，raw bytes匹配同SHA ARM64 slice。

未通过项为：`noUndecodedGaps`、`fullByteCoverage`、`instructionAddressesMatchLldb`。原因：入口seed的followFlow在 `0x1007d7d6c: brk #1`停止；尾部 **0x1007d7d70–0x1007d7eef，384B**无普通入口边，Ghidra未解码。实际Ghidra1135条/4540B、127 CFG块254条边；LLDB则按所选完整范围线性解码1231条/4924B，包括尾96条。

LLDB尾部含drop/free/panic_in_cleanup/_Unwind_Resume等调用，**与EH cleanup候选相符，但本轮尚未解析LSDA，不能称已证实全部异常入口或完整异常CFG**。Ghidra loader另报`Failed to markup: LC_SYMTAB (symbols)`，只导入0个附加库；因此未使用其符号恢复为定位依据，入口绑定依靠独立export trie+LC_FUNCTION_STARTS。

保留原脚本、focused/verification/ASM/伪代码不改、不冷重试。下一步独立复核冻结报告中已解码指令与LLDB；只分析两个必要直接helper（key464B、string344B），验证追加顺序与空字符串语义。可以形成**限定普通入口成功流**的字段规则结论，但完整Ghidra覆盖/异常CFG仍未通过，后续报告必须携带此限制，不拼成整函数/运行时证明。
