# 新版engine设置键已绑定，effective尚未证明

版本严格绑定新冻结chat：公开bundle metadata2.35.2，完整SHA `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`，ARM64 slice offset215023616；[身份与签名](../identity-rebind-01/SUMMARY.md)。所有分析为静态：没有官方CLI/JS执行、真实HOME/auth读取、网络、模型或app源码修改。

## 查询键的直接机器码证据

[converter报告](converter/REPORT.md)：新240B lookup在`0x101a0f81c`的实际BL字`0x97ee4fc4`指向新函数表确定的`[0x1015a372c,0x1015a375c)`，48B/12指令。converter计算`((key XOR 0x80)&0xff)*8`，从两表返回`x0=pointer,x1=length`。

| 数字键 | length entry VA | pointer entry VA | 返回pointer | len | 精确字符串 |
|---|---|---|---|---:|---|
| 0x73 | 0x108c56298 | 0x10b8d0168 | 0x108c58e00 | 16 | `chat.agentEngine` |
| 0x35 | 0x108c560a8 | 0x10b8cff78 | 0x10482f5e3 | 7 | `chat.ui` |

Length table base`0x108c55b00`，pointer table base`0x10b8cf9d0`；新section边界内的原始pointer直接匹配，无猜fixup/归一化。caller传入的0x73因此已绑定`chat.agentEngine`，fallback的0x35已绑定`chat.ui`。这取代此前“数字键身份未知”的局部结论，但不恢复源enum/参数名，也不证明当前设置值/分层来源/实际UI或engine。

## getter与fallback不是统一default

[lookup/fallback报告](lookup-fallback/REPORT.md)：新实际范围为lookup`[0x101a0f800,0x101a0f8f0)`240B、fallback`[0x101894f90,0x1018951d4)`580B，共60+145条连续指令全部核原bytes。getter按object+0x48、条件object+0xa8、object+0三个map顺序查，来源名尚未绑定，不把它们擅称workspace/global/env。成功返回0x68B entry+0x18，否则NULL。

Missing/错类型与不可识别字符串路径不同：前者保留fallback两个返回值，后者只取第一个、强制另一个来源字节1。因此不能将其洗成一个default值。

fallback返回`(w0,w1)`：`w2==0`或input+0x12c bit0→(0,3)；否则+0x134 bit0→(0,2)；否则+0x135 bit0→(1,2)；再进入`KIRO_CHAT_UI`字面量相关读取/解析。该读取helper尚未展开，不能凭字面量声称已证实时环境读取。接受文本按ASCII不分大小写比较`tui`→0、其他→1，第二值2；初始缺失/不适用可继续查`chat.ui`。其missing/错类型→(0,3)，接受的空串→(1,2)，非空同`tui`比较。

## 仍未知

- flags字段名、getter三map来源和全部覆盖优先级。
- 历史单key stored `chat.agentEngine=v3`不等当前session effective，不能因0x73键名现已绑定而跳结论。
- 官方外层自然KAS Node/Command启动，当前AB/API分支、实际endpoint/UA/proxy和请求。
- Mac监督/HTTP观察门禁、精确`deepseek-3.2`实时可用性及最终parity。

所有新窗口合计converter相关343B（其中getter240B已取得）、lookup/fallback820B；没有展开std/allocator。命令/退出码/字节/SHA及主侧保全readback见各目录。converter初始采集inline未单独保存；独立verify.py、合成脚本、manifest、ASM与原始数据均已保存，不冒称原命令全文可复现。
