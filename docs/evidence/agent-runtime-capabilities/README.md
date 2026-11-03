# 运行时能力统计证据与复现

此目录只包含**研究文档、静态统计数据和研究脚本**。不包含业务适配器实现；脚本不会启动Axiom、执行模型、安装依赖、读写会话或重启服务。

入口：[全面统计报告](../../agent-runtime-capability-inventory.md)；[已有适配器契约](../../agent-runtime-adapter-contract.md)。

## 产物

| 文件 | 用途 |
| --- | --- |
| [scan-pi-coupling.mjs](scan-pi-coupling.mjs) | 用当前安装TypeScript解析app/src，产出模块/绑定/引用/语法图及源码hash |
| [pi-coupling-inventory.json](pi-coupling-inventory.json) | 原始文件manifest、AST识别结果和可解析依赖边 |
| [pi-coupling-summary.json](pi-coupling-summary.json) | 源码、包、类型声明、私有路径及图统计 |
| [capability-matrix.json](capability-matrix.json) | 人工归一化的能力/约束源数据，带来源与现状 |
| [render-capability-inventory.mjs](render-capability-inventory.mjs) | 验证结构/来源/分类映射，生成下列三份文档/数据 |
| [capability-summary.json](capability-summary.json) | 域、主责、状态、来源文件和94文件分类映射统计 |
| [capability-matrix.md](capability-matrix.md) | 完整151项矩阵，所有来源可点击 |
| [pi-coupling-appendix.md](pi-coupling-appendix.md) | 完整94文件、100包内符号、私有路径与59间接语法依赖 |
| [validation.md](validation.md) | 最终独立审阅与文档/数据静态检查范围及结果 |

## 复现

工作目录为仓库根目录；需要当前项目已经安装的Node及 `app/node_modules/typescript`。不额外安装任何包。

```sh
node docs/evidence/agent-runtime-capabilities/scan-pi-coupling.mjs
node docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs
```

第一条默认更新本目录inventory/summary；第二条读取这份snapshot与人工matrix，更新三份生成产物。两者均可提供一个输出目录参数，将产物写到临时目录：**scanner的临时输出不会自动成为renderer输入**，renderer仍读取本目录已保存的数据。

临时输出目录应使用**物理绝对路径**：macOS的`/tmp`是指向`/private/tmp`的符号链接，直接传逻辑路径会使生成MD的相对链接失效。可先用`OUT="$(mktemp -d)"; OUT="$(cd "$OUT" && pwd -P)"`解析目录，再运行`node docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs "$OUT"`。本轮已用物理路径验证复现；没有修改脚本的符号链接处理。

renderer验证ID唯一/顺序、列齐、主责/状态合法、来源文件存在、来源字节未偏离已存manifest、94直接文件都有分类。若并行开发改了来源，renderer会报manifest漂移而不是悄悄生成“当前”文档；应审阅变化、重跑scanner，再同步主报告的数字/hash。历史快照不是实时声明，不要只改一个数字掩盖漂移。

这些脚本是统计和文档工具；`noResolve/noLib`的AST解析、`node --check`及JSON断言**不等于TypeScript业务类型检查、产品测试或接口集成测试**。

## 独立语义审计

以下保留了五份完整的领域审计。它们是归一化矩阵的详细旁证，不同报告范围有交集，原始能力数不可相加。行号及LOC来自各自观察时点，后续并行变更以最终manifest和主报告为准。报告中的绝对源码链接用于原审计环境；可移植的完整分类链接见生成矩阵。

- [执行、输入、配置、安全点和事件](audits/live-control.md)
- [原生存档、分支、重写、恢复和压缩](audits/native-archive.md)
- [工具、资源、MCP、任务、记忆和标题](audits/tools-resources-jobs.md)
- [模型、认证、观测和用量](audits/model-auth-usage.md)
- [API、shared、UI语义和测试范围静态盘点](audits/api-ui-tests.md)

独立统计器复核：[完整说明](audits/scanner-review.md)、[文本对照](audits/independent-text-check.json)、[范围/图对照](audits/graph-and-scope-check.json)。该复核在最终snapshot之前执行，核心计数一致；不是对所有后续源码变化的原子证明。

矩阵语义：[首次审阅](audits/matrix-review.md) / [事实修订复核](audits/matrix-recheck.md)。最终边界：[整体审阅](audits/final-contract-review.md) / [三处措辞复核](audits/final-contract-recheck.md)。文档数据：[首次静态检查](audits/final-static/report.md)保留来源漂移导致的renderer拒绝；[刷新后复核](audits/final-recheck/report.md)记录新snapshot的837项断言、20项差分及物理路径14项复现检查通过。报告、脚本、结果JSON、日志和真实退出码已归档；复制的验证脚本保留原环境绝对路径，属于审计记录而非新通用命令入口。

## 计数边界

- 600代码文件和94直接引用来自app/src，不是全仓文件总数。生成的vite-cache不计入；仓库外插件和tests目录不在扫描范围。
- type/value依显式声明；value不证明执行，type-only也不排除原生私有状态耦合。
- 100是包内去重导入名，不是方法数；155只统计导入根语法调用，漏掉实例方法、反射和传递效应。
- 153是可解析**语法**反向闭包，含type-only和字面worker URL；漏本地import-type/require/别名/计算路径等，不是完整运行时调用图。
- 私有JS/借用依赖识别是有限形态启发式；127字面量锚点、8私有路径、2借用依赖不可直接相加为总依赖数。
- 151是人工审计分类；94/94只证明直接引用文件都被分类，**不证明语义穷尽、测试覆盖率、SDK已实现或多runtime已工作**。
- 代码树并行变化，不是原子快照；逐文件hash用于识别漂移。若新增审计结论，先对照当前源码再更新矩阵和主报告。
