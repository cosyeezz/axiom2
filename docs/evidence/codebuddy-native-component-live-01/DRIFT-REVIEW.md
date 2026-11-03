# 范围外Kiro漂移复核与阻断

状态：Waiting，实发未启动。t12369/r12372独立静态复核已消费。不是CodeBuddy协议失败，也不是新的Kiro功能验收；需并行工作完成并建立稳定、来源清楚的源码/构建快照后重新准入。

## 观察

- 原Kiro catalog source SHA `b87bd5bf05a142771f9aaf9fee8ca6325655d3e6252c0ca719d7419ff724e491`，先变为`782be3978cfdf6151699365ae31cdbd4687801291a02eb8873066d63fe640182`，复核时又变为`6e4de40fa7761b47ccc2e764b0813e31c6131254ca1d34c843ce0836eec88ebf`。
- 原emit SHA `b22e3b9926f19ad5fa6a461f47eaa24768b17424c5696d05bbaf547aed04ce66`，变为`5e089f41903e14505f85cb878e6e25dfe05886676d660c126fbf1cf39429435d`。
- 主代理比对其余59源码/32组件emit仍与既有证据相同；独立复核没有重复核这59/32项。
- 独立复核在仓库根目录运行Node heredoc，使用本机TypeScript6.0.2 API读取tsconfig.server.json并createProgram().emit()到内存，不写生产文件，exit0。config/emit diagnostics为空，但当前source生成物SHA为`70b6370be7be015af7e82723944849ad3be4784ddd6b4ddf680b5c49ce7e2e57`，与磁盘emit不相等。
- 当前catalog.ts第5行新增resolveKiroProfile导入，第138–139行调用；catalog.js第151行对应函数没有此调用。不是纯格式差异。文件在本步骤期间持续变化，本主代理没有修改或build它们；具体修改方未归因。

## 可隔离边界

- catalog.ts及profile.ts顶层是导入、常量、函数定义，无自动网络/读凭据/定时器/注册；profile企业网络查询仅函数体内（profile.ts第21行起）。
- server/model-runtime.ts第14行Kiro factory为惰性dynamic import；140–152行providerScope构造唯一needed集合。因此固定codebuddy-cn不注册Kiro，不调用其catalog/scope/凭据函数。第137行SDK创建不刷新；197–204行只恢复已选动态provider，allowNetwork:false。
- providers/codebuddy-cn.ts第29行和codebuddy-chat.ts第4行直接使用CodeBuddy模块。固定Flash/off没有Kiro功能分支。
- 公共native-providers/index.ts第13行会加载Kiro模块，但不会自动调用其catalog；不能宣称所有入口都不加载Kiro。

## 当前处理与恢复条件

不能固定已经过时的两个SHA，也不能通过放宽门禁掩盖并行变化。此前临时source-only例外已经撤回，HARNESS恢复原60源码/33source+33emit严格门禁；当前旧自测/import指纹不可live。没有覆盖、恢复或重新构建并行Kiro文件。

必须先协调并行修改完成或取得不可变构建快照，再核当前source/emit及闭包影响；若采用新快照，要显式更新本case基准和限定范围，重新生成新名selftest/import/preflight证据后才能claim。任何进一步漂移、修改scope、显式注册Kiro或放开目录网络都须重新评估。本case不要求或授权启动旧Kiro实发/重试任务。

未执行真实runtime推理、旧harness、完整类型检查或Kiro新功能测试，未读真实auth文件，未发外部请求/取得claim。
