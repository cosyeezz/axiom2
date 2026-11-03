# S1：Mac 顶层字段省略与顺序的局部静态结论

**状态：`supported_static_entry_flow_with_known_gaps`。** 已交付一个限定普通入口成功流的静态结论；**不是整函数覆盖通过、当前模式可达、真实请求或最终 parity 通过**。两个原capture runner的`exit1 / failed_checks`保留不改。本轮真实模型请求 **0**；官方程序launch/attach/执行 **0**；应用源码修改 **0**。

## 1. 版本与定位

目标为[环境报告](../environment.json)绑定的官方 **Kiro CLI 2.35.1 / macOS / ARM64** `kiro-cli-chat`，完整SHA256 `d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1`；ARM64 slice SHA256 `558b27343a899ea123db9f9edb52c6bb2f65d712fe4c137919feab490bf620f7`。所有本轮分析均只读，前后完整文件/slice/源码指纹一致；不证明原子loaded image。

[初始实验与预算](../static-locate-01/EXPERIMENT.md)、[Mach-O定位](../static-locate-01/locations.json)、[export-trie定位](../static-locate-01/exports.json)：

- LC_SYMTAB仅684项，无选中serializer符号。不能据此称没有代码。
- 在`__LINKEDIT`出现的目标名来自dyld export trie。一次元数据解析访问20851节点、13457终结项，找到精确 `GenerateAssistantResponseRequestSerializer as SerializeRequest::serialize_input`。
- 普通非re-export地址 **0x1007d6bb4**，与LC_FUNCTION_STARTS起点吻合；下一项 **0x1007d7ef0**，并有下一个streaming deserializer export交叉支持，完整范围 **4924B**。
- 只为完整范围核验，将本函数上限从4096调为8192B，说明见[定向实验](../static-analysis-01/EXPERIMENT.md)。Ghidra `-noanalysis`、8GiB/CPU4、单函数decompiler 20秒，未启动全程序analyzer或递归callee分析；loader仍解析元数据/fixups。Ghidra的LC_SYMTAB markup警告保留，定位不依赖其符号恢复。

## 2. 已支持的字段规则

依据[serializer ASM](../static-analysis-01/lldb-asm.txt)、[Ghidra指令与CFG](../static-analysis-01/focused.json)、[伪代码](../static-analysis-01/decompiled.c.txt)，观察到如下**分析者概括，不是恢复的原Rust源码或类型声明**：

```text
append('{')
if conversationState.slot != 0x8000000000000001:
    append_key("conversationState")
    construct_and_close_conversation_object(...)  // 其成功路径
if profile.slot != 0x8000000000000000:
    append_key("profileArn")
    append_string(profile.pointer, profile.length)
... agentMode?, additionalModelRequestFields?, systemPrompt? ...
append('}')
```

| 证据地址 | 可观察事实 |
|---|---|
| `0x1007d7190–7198` | conversationState的缺省标记比较；相等跳到`76a8` |
| `0x1007d719c–71ac` | 非缺省时把literal **0x1047becbd**、长度17（`conversationState`）送key writer |
| `0x1007d7698` | conversationState对象成功收尾写`}`，随后进入profile分支 |
| `0x1007d76a8–76b4` | profile首word与 **0x8000000000000000**比较；相等跳到`76d4`，省略字段 |
| `0x1007d76b8–76c8` | 非缺省时把literal **0x1047bd999**、长度10（`profileArn`）送key writer |
| `0x1007d76cc–76d0` | 取pointer/length并调用字符串writer；此处**不是length非零判断** |

因此：**这个serializer普通成功流按缺省标记省略profileArn，否则调用字符串writer；conversationState在profileArn之前处理。** Rust `None`/`Some`的完整输入布局映射未独立恢复，不能把分析者的字段标签当原类型证明。

同一成功构造流可见的顶层调用顺序为：

`conversationState? → profileArn? → agentMode? → additionalModelRequestFields? → systemPrompt?`

这只是字段存在时的静态顺序；不证明当前账号、agent、模型、V3配置会填入这些可选字段或执行此serializer。

## 3. 两个必要helper确认的是即时追加

[helper实验](../static-helpers-01/EXPERIMENT.md)、[key伪代码](../static-helpers-01/key.c.txt)、[string伪代码](../static-helpers-01/string.c.txt)、[完整范围LLDB ASM](../static-helpers-01/lldb-asm.txt)。只新增这两个直接helper，至此主动分析3个唯一函数，没有进入第四个函数或allocator闭包。

- `0x100c113d4`（`JsonObjectWriter::key`）：`11410`按已有成员状态写逗号，`11444`写开引号，`11454`调用内容处理helper **0x100c0fb8c**，`11484`复制其返回数据，`114c0`小端写`0x3a22`即`":`，`114d0`返回同一buffer。正常返回时key已经追加，不是收集字段后排序。
- `0x100c10d1c`（`JsonValueWriter::string`）：`10d58`写开引号，`10d68`调用 **0x100c0fb8c**，`10d8c`复制返回数据，`10dbc`写闭引号；可见普通流没有根据输入length=0省略整个值的分支。
- **未分析0x100c0fb8c**，所以不宣称已验证全部转义语义、`Some("")`的最终输出bytes、所有错误路径或完整Rust类型映射。

## 4. 原门禁失败与验证范围

| 范围 | Ghidra入口流 | LLDB完整范围 | 保留缺口 |
|---|---|---|---|
| serializer 4924B | 1135条/4540B，127块254边 | 1231条/4924B | `0x1007d7d70–7eef`，384B |
| key 464B | 109条/436B，15块27边 | 116条/464B | `0x100c11588–115a3`，28B |
| string 344B | 79条/316B，11块20边 | 86条/344B | `0x100c10e58–10e73`，28B |

- [serializer原verification](../static-analysis-01/verification.json)父 **exit1**；其LLDB **exit0 / 7.744s**、Ghidra **exit0 / 10.404s**。
- [helpers原verification](../static-helpers-01/verification.json)父 **exit1**；其LLDB **exit0 / 6.898s**、Ghidra **exit0 / 10.850s**。
- 均无timeout，反编译完成；bytes匹配当前slice。全部已解码指令与LLDB的地址/机器码/ASM和普通CFG交叉对应。LLDB的线性完整范围解码**不补足Ghidra的缺口或异常CFG**。
- 主入口跟随显式流在BRK/return处分离尾部；尾部可见free/drop/`panic_in_cleanup`/`_Unwind_Resume`，与异常清理候选一致。**未解析LSDA/EH，不能称尾部不可达、已恢复全部异常入口或整函数CFG通过。** 原[serializer失败说明](../static-analysis-01/FAILURE.md)和[helpers失败说明](../static-helpers-01/FAILURE.md)保留，不改oracle洗绿，不冷重试。
- 只读独立审计 `t10919/r10920` 核产物/export/范围和Axiom；`r10932` 核serializer全部已解码指令/CFG，`r10944` 核两helper。结果均已读回并主核。后两审计各有一次自身临时核验器错误（BRK/块内call边、零移位表示），修的是核验器，不是被审产物；不将这些诊断计为目标通过执行。
- 新增官方分析仅 **2次headless导入、3个唯一函数反编译、2次LLDB离线session**；没有重跑serializer、环境夹具或已过未改测试。最终review只整理冻结证据，没有新增目标执行或模型调用。[指纹与结论manifest](verification.json)不替代原始报告。

## 5. 与Axiom当前默认路径的有限对照

[kiro-chat-protocol.ts:155](../../../../app/src/server/providers/kiro-chat-protocol.ts#L155)默认构造 `conversationState → profileArn?`，profile使用truthy条件。后续[kiro-chat.ts:121–146](../../../../app/src/server/providers/kiro-chat.ts#L121)可以追加`additionalModelRequestFields`，`onPayload`也可修改或替换payload，再严格核profile/model/origin，然后直接`JSON.stringify`，不排序。

- 在**无hook改写、profile为普通非空字符串**的默认构造路径，两个顶层字段相对顺序与上述静态serializer一致。不是完整正文一致，也不是Axiom实际出站证据。
- `undefined`会默认省略；空字符串虽在构造时省略，但默认发送前`undefined !== ""`会报错，不能说“空串省略后发送”。identity-center假值profile还可能先进入发现分支。空串账号的合法性/真实可达性未证明。
- 官方serializer候选支持额外顶层字段，不证明当前官方模式一定使用。**不据此移动或删除用户system/custom/history/tools/security，不凭静态候选修改生产协议。** 本轮应用源码未改，不新增应用测试。

## 6. 下一门禁与V3变量

用户报告其客户端提示开启某个 **“V3”配置**，要求后续排查请求一致性。确切提示名/配置键、客户端产品、是否已开启和生效路径尚未知。已记录待办，建议保存原文或截图及状态，**不为测试擅自切换**。

建立官方基线前，要核它是否改变引擎、有效上下文、路由或请求结构；开启前后版本与证据必须分开。当前这份静态结论**不证明V3启用后的路径**。后续仍先过Mac专用非模型观察夹具；`deepseek-3.2`实时可用性、真实启动链、明文/wire/服务器观察均未验证。本报告不授权提前发模型请求，不替代最终服务器可观察行为验收。
