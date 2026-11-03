# 新snapshot独立最终复核（保留原轮证据）

## 结论

**新9f42 snapshot重新执行837项静态断言全部通过，另20项更新/差分检查通过；物理临时路径renderer实际exit0，14项复现检查通过，summary字节一致、两份生成MD规范化相对链接后全文一致。未发现当前源码manifest漂移。**

工作目录：`/Volumes/D_Work/axiom2`。本轮时点：2026-10-28T18:06:55Z—18:09Z。原 `/tmp/axiom-runtime-final-static` 的report/results/exit均未覆盖。本轮837是对新snapshot**实际重跑**所得，并非沿用原轮结果；脚本复制到新目录，仅将输出根路径替换、两处期望64445改为64447。

新报告保留一个额外发现：首次直接传 `/tmp/...` 的renderer虽exit0，生成链接受macOS `/tmp -> /private/tmp` 影响，在真实文件系统上无效，因此第一次比较wrapper exit1。改为传入隔离目录的**物理绝对路径**后，renderer仍exit0且所有比较通过。正式项目MD本地链接全部有效。未修改renderer或项目，也未隐藏首次失败。

## 命令、真实退出码和证据

| 实际命令 | exit | stdout/stderr |
| --- | ---: | --- |
| `python3 /tmp/axiom-runtime-final-recheck/verify.py` | 0 | [01.stdout](01.stdout.log) / [01.stderr](01.stderr.log) |
| `node docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs /tmp/axiom-runtime-final-recheck/rendered` | 0 | [02.stdout](02.stdout.log) / [02.stderr](02.stderr.log) |
| `python3 /tmp/axiom-runtime-final-recheck/render-and-compare.py` | 1 | [03.stdout](03.stdout.log) / [03.stderr](03.stderr.log) |
| `node docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs /private/tmp/axiom-runtime-final-recheck/rendered-realpath` | 0 | [04.stdout](04.stdout.log) / [04.stderr](04.stderr.log) |
| `python3 /tmp/axiom-runtime-final-recheck/render-and-compare-realpath.py` | 0 | [05.stdout](05.stdout.log) / [05.stderr](05.stderr.log) |
| `python3 /tmp/axiom-runtime-final-recheck/supplement.py` | 0 | [06.stdout](06.stdout.log) / [06.stderr](06.stderr.log) |

renderer由对应Python wrapper调用；上表不是额外重复执行两遍。全部真实退出码独立保留于 `01.exit`—`06.exit`，索引见 [commands.json](commands.json)。没有把首次比较exit1改报0。按要求未重复node --check（两脚本与旧备份逐字节一致），未执行scanner、产品test/check/build、模型、安装或网络。

## 新snapshot静态结果

详见 [results.json](results.json) 与可复查 [verify.py](verify.py)。本轮输出明确 **CHECKS837 / PASS837 / FAIL0**，sourceDrift为空、代码文件集合无新增/删除。

- 600代码文件、**64,447行**：server269 / 36,984，client259 / 22,554，shared72 / 4,909。新主报告相关表格及说明数字与JSON一致。
- 151项/14域：E10、S8、I11、V10、T10、R12、C8、A12、B11、P14、M17、U10、J10、H8。状态live136 / partial8 / helper1 / gap2 / new4；主责runtime40 / archive23 / resources14 / model17 / host57，分别和151。
- 163来源文件存在，**94/94直接Pi文件分类齐全**。127模块点、277绑定、100包内去重符号、155直接call/construct语法引用不变。图从保存边重新计算153=94+59。
- 附录全94文件、100符号及各符号绑定/type/value/引用数、全部来源文件与JSON逐项匹配；151矩阵生成行所有语义字段和来源链接均匹配。
- 14份MD、1609个本地链接出现项（含历史audits）目标存在；非历史锚点、表格列宽、围栏配对、冲突标记检查通过。历史审计不强求旧LOC/源码行号等于新snapshot；validation进行中占位不计事实缺陷。
- JSON重复键/结构、summary全量一致、计数求和、manifest重建、主报告数字与hash适用声明均通过。

## Hash与旧快照差分

- 新manifest：`9f42b477d57636707e0e1d2a078fee8f33357a1504d89e4f7931f8e80043dd78`。
- matrix SHA256仍为：`3d117c9f13818ff03fe433c431cd0f41d8fcaa644cc39d96858c65b45ea215e9`。
- [supplement-results.json](supplement-results.json) / [supplement.py](supplement.py)：**20项实际通过**。与 `/tmp/axiom-runtime-snapshot-64c5a847/docs/` 旧备份相比，manifest文件集合不变，仅usage-materialized-store.ts的manifest条目变化；fileModes、sites、bindings、localEdges、unresolvedLocalEdges、parseDiagnostics及piReachableFiles全量相等。matrix与两个mjs字节一致。
- [contract-prose.diff](contract-prose.diff)保留契约差分：恰为三处prose（脏树提示、ModelGateway消费宿主授权引用、压缩单写者协调/双策略并存）；**两段TypeScript围栏逐字节相同**。本轮只验证差分，不执行类型检查。

## renderer复现与临时路径链接问题

[reproduction-results.json](reproduction-results.json)保留第一次14项比较，其中6项失败：两个MD的规范化全文/hash及实际链接存在性。原因有直接证据：输出参数为逻辑 `/tmp/axiom-runtime-final-recheck/rendered`，renderer按该逻辑路径计算 `../../../Volumes/...`，而macOS真实目录位于 `/private/tmp/...`，链接实际指向不存在的 `/private/Volumes/...`。两份summary的deep JSON、字节SHA及stdout在此轮已一致。不是源码manifest漂移，也不是能力统计差异；这是临时输出经符号链接目录时的可移植性边界，建议后续可单独考虑realpath处理，不在本次修改研究脚本。

第二次输出参数取 `Path(...).resolve()`，实际命令使用 `/private/tmp/axiom-runtime-final-recheck/rendered-realpath`。[reproduction-results-realpath.json](reproduction-results-realpath.json) **14项全部通过**：

1. 三个输出文件名称齐全；capability-summary.json深JSON、字节hash及renderer stdout与正式summary完全相等。
2. 两份MD仅将链接目标解析为同一仓库绝对目标（保留label、fragment及全部其他正文），规范化后**全文和SHA256相同**。不是仅比较统计数字或删除全部链接后的弱对照。
3. 两份临时MD实际本地链接存在性也通过，所有源文件链接仍可定位。
4. renderer/compare前后全部被查项目文档/数据/脚本字节指纹一致：[reviewed-artifact-hashes.json](reviewed-artifact-hashes.json)。

证据文件包括两组normalized MD及diff；`*.realpath.diff`为空，第一组diff保留。两次renderer均exit0，无来源漂移文件可列。

## 未验证与边界

本轮仅静态研究：没有重新执行scanner的AST扫描、模型/Pi/DSH、业务测试、类型检查、构建、网络、性能/并发/取消/崩溃恢复、外链HTTP或浏览器渲染。图/符号结构从保存snapshot独立重算；真实源码hash逐文件比对，不是原子文件系统快照。外部变更constructor清理逻辑的业务正确性由主代理已审阅，本轮不另作运行验证。正式validation.md未修改，仍由主代理据真实结果填入。
