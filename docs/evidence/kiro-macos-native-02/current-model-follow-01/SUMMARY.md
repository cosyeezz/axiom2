# 标题caller与feature-env解析：静态直接依赖

唯一[工具结果](TOOL-RESULT.json)actual0/.5s，[RESULT](RESULT.json)内部.465386917s；完整public JS15025207B/SHA bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1、sameFD前后stamp同。[合同](EXPERIMENT.md)/[driver](follow_once.py)/[manifest](MANIFEST.json)先存，新gate已耗尽。driver2944B/55e0c384071431b1b72b91e17c3fa119009339cad5e825526ad3b8d17b17a8bb；3patterns/5hits，其中2hit复用[前一窗口](../current-model-execution-01/EXCERPTS.txt)，本次4窗10238B。[EXCERPTS](EXCERPTS.txt)10423B/59ae0b0fb719fe5c3bd300d7054e145ab4e195d787b383fb28e718f4285f3537。official/JS/模型执行0，没有读取真实env/配置/账号。Python PID/whole-author/OS-loader读取未记录。

- `[3419692,3421231)`：全局`CL="simple-task"`，这是title路径传入的selector常量，不是已证明的底层服务模型ID，更不能猜为某Claude或deepseek。
- `[14799081,14800640)`：prompt路径内U closure先appendMessages，`if(h)return`；随后通知用户消息。当`!r.hasReceivedPrompt`且`hne(J)`非空时，设置首标题、hasReceivedPrompt=true并调用kickoffLlmSessionTitle(r,J)。`h`含义及正常主推理对U的调用时序未在此窗完整核定，不声称title必先发或一定触发。
- `[8372600,8378200)`：Tte是source="env"的provider，消费constructor传入对象；查feature映射名后trim。缺失/空串返回qA；只接受小写字面"true"/"false"并返回boolean，否则warn+qA。**实例是否收到process.env、组合registry优先级和本次有效值未核**；不能仅凭映射和parser便宣称env禁用了fallback。
- `[12175729,12177269)`：FIi返回isEnabled(trigger)→enabledTriggers.has、isAutoRefusalEnabled、resolveTarget及applySwitch。resolveTarget内部只有尝试数上限检查，然后loadChains；**内部没有先调用isEnabled**，因此disabled是否阻止target解析/请求取决于caller，仍未核。applySwitch在非workflow条件下尝试override。

这收窄了首candidate可能不是主请求的风险，但没有证明自然CLI单次总推理。已知直接title-disable guard可作为未来明确的受控输入候选，实际继承必须观察；尚未设置真实环境或发prompt。下一优先fresh核当前Axiom完整输入入口，再按正式合同需要补最小registry优先级/调用门控，不进入全应用内部调用闭包。
