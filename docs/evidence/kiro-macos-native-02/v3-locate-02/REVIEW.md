# V3 离线排查：已定位强候选，等待实际客户端状态

**结论：官方Mac Kiro CLI 2.35.1产物确有V2→V3引擎切换及agent配置迁移提示。用户所见提示、实际客户端/生效engine尚未确认；不关闭基线门禁，不擅自切换。** 本轮0模型请求、0设置写入、0应用源码修改；只执行过一次隔离的`settings --help`，未执行单key getter、chat、`--v3`或升级命令。

## 定位与成功范围

[实验](EXPERIMENT.md)、[流式定位源](locate_v3.py)、[完整候选](locations.json)绑定此前完整chat SHA256 `d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1` 与ARM64 slice SHA256 `558b27343a899ea123db9f9edb52c6bb2f65d712fe4c137919feab490bf620f7`。一次实际扫描 **exit0 / 1.226秒**：

- `__TEXT,__cstring` 1271569B，70个raw `v3`命中、64个ASCII上下文候选；
- `__TEXT,__const` 112409560B，2445个raw命中、172个ASCII候选；
- 合计236候选、无截断；64KiB core+480B上下文，最大scan read66016B。

没有全程序解码/反编译，没有重跑此前serializer/helper或已过环境夹具。原[v3-locate-01失败](../v3-locate-01/FAILURE.md)在设置2GiB RLIMIT_AS时exit1，**读取目标/扫描0**，保留原件，不归为目标或配置失败。新case改成有界流式读取，**不宣称有OS 2GiB内存硬限证明**。

## 三类提示不能混同

以下VA只适用于此ARM64产物。`__TEXT` fileoff=0，完整文件offset为`215023616 + VA − 0x100000000`。

| 位置 | 原始静态文案及解释边界 |
|---|---|
| `0x108c34af0`附近 | `You're using Kiro CLI V2. Switch to V3 today.`，随后介绍workflows/cloud sessions/specs及单次`kiro-cli --v3` |
| `0x108c34b81`起 | `Switch to V3 and upgrade my configs` / `Remind me later` / `Don't ask again`。这是引擎切换并迁移配置的候选提示，不是普通外观选项 |
| `0x10422a599`起 | `Run with --v3 for this session, or switch with`，随后给出`kiro-cli settings chat.agentEngine v3`。这是**写入/切换文案，本次未执行** |
| `0x104827600`窗口 | `Agent engine to use: "v1", "v2" (default), or "v3"`。`v2`只是内置帮助标称默认，不是本机生效值 |
| `0x108c3505a`起 | `Your agent configs are still in the V2 format. Upgrade them to run on V3? They'll keep working in V2.`。这是配置格式升级提示，不能仅因包含V3就认定当前仍在V2 |
| `0x104829280`窗口 | `Auto-upgrade V2 agent configs to the V3 format on launch: true (upgrade silently), false (never). Unset prompts once.`。尚未把该说明绑定到一个精确设置key，不能猜成`chat.agentEngine`的布尔别名 |

产物中还有`V3 is saved as your default, but this command chooses another engine, so it runs there.`文案。因此即便之后拿到持久化`chat.agentEngine`，仍需区分**存储默认、启动参数和本session实际engine**，不能用默认值代替当前可达性。上述字面量并未恢复完整优先级控制流。

## 只读查询的已证与未证

[隔离帮助实验](../v3-readonly-01/EXPERIMENT.md)与[实际报告](../v3-readonly-01/verification.json)：官方launcher在空TEMP HOME/cwd、最小env下运行一次`settings --help`，sandbox禁止network、文件写入、真实HOME读取和securityd lookup。**exit0 / 0.019秒 / stdout924B / stderr0 / 无timeout或截断**；[帮助原文](../v3-readonly-01/settings-help.txt)给出：

`kiro-cli settings [OPTIONS] [KEY] [VALUE]`

并列出delete/global/workspace/format。它没有直接说明单key读取契约及其存储路径。**未为“确认状态”而试跑可能写入的命令、打开settings、导出全部设置或读取登录DB/Keychain。** 隔离help不代表用户实际状态、运行时观察fixture或整树监督已通过。

## 独立审查及边界

- `t10970/r10977`：公开dashboard/manifest的9文本共4692101B，未发现V3 setting/提示；JS里的12个`v3`为Base64或压缩变量。不代表其他组件没有V3。manifest为2.35.1/stable。
- `t10970/r10988`：独立读取7个目标窗口共7552B，确认V2→V3提示、setting写入文案、帮助默认和配置升级语义；未重新全hash/全扫/执行。两个只读Python命令均exit0，未取得精确getter或存储路径。
- 主核[有限读回核验](verification.json)校验236候选的源bytes/地址、三个独立窗口SHA、公开资源SHA及帮助证据。该成功只表示离线定位/交付完整性，不是用户状态或请求parity。

## 恢复条件

需要用户确认：**实际客户端/版本、看到的提示原文或截图、是否已选切换/升级、平常启动命令或当前engine状态**；无需任何token、登录文件或其他secret。若静态候选就是用户所见，再按已确认的引擎确定实际Mac调用链和观察夹具边界。

在此之前维持0模型请求/不改设置；不将既有[serializer局部静态结果](../static-review-01/SUMMARY.md)视为V3实际路径。Mac观察夹具需要选择真实对应路径，官方受控基线、差异修复及多场景传输核验继续受该依赖及原有非模型门禁约束。
