# Agent Runtime 最终独立静态核验

## 结论

**正式 snapshot、汇总、151项矩阵、94文件/100符号附录和主报告内部一致；837项独立断言全部通过。renderer实际退出1：发现一份外部业务源码manifest漂移，属于预期保护，不是已证实程序缺陷。渲染端到端复现未通过/未完成，不能报告renderer成功。**

工作目录：`/Volumes/D_Work/axiom2`。核验时点：2026-10-28T18:03:56.519573+00:00。仅写入 `/tmp/axiom-runtime-final-static`，未修改项目、正式snapshot或历史审计，未执行网络、安装、产品test/check/build、模型或scanner扫描程序。

## 实际执行与退出码

| 命令（相对路径以工作目录为准） | exit | 日志 |
| --- | ---: | --- |
| `node --check docs/evidence/agent-runtime-capabilities/scan-pi-coupling.mjs` | 0 | [stdout](01.stdout.log) / [stderr](01.stderr.log) |
| `node --check docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs` | 0 | [stdout](02.stdout.log) / [stderr](02.stderr.log) |
| `node docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs /tmp/axiom-runtime-final-static/rendered` | 1 | [stdout](03.stdout.log) / [stderr](03.stderr.log) |
| `python3 /tmp/axiom-runtime-final-static/verify.py` | 0 | [stdout](04.stdout.log) / [stderr](04.stderr.log) |

真实子进程退出码见 [commands.json](commands.json) 及 `01.exit`—`04.exit`，未把renderer失败归零。独立校验脚本：[verify.py](verify.py)；重跑辅助：[run-checks.py](run-checks.py)；逐项断言/链接明细：[results.json](results.json)；被审文件字节指纹：[reviewed-artifact-hashes.json](reviewed-artifact-hashes.json)。辅助脚本尚未额外执行，实际命令以上表为准。

## 独立核验范围和结果

1. 全范围JSON可解析，拒绝重复键；inventory顶层/manifest条目结构、matrix schema/7列、每格非空、owner/state合法。历史audits JSON仅解析，不强求其旧LOC/绝对行号等于最终快照。
2. **151项 / 14域**，唯一连续ID；分域 E10、S8、I11、V10、T10、R12、C8、A12、B11、P14、M17、U10、J10、H8。主责 archive23、host57、model17、resources14、runtime40，和151；状态 gap2、helper1、live136、new4、partial8，和151。
3. **163来源文件存在，94/94直接Pi文件均被至少一个能力分类，无漏项**。从127 sites独立推导94文件及type-only43 / mixed30 / value-only21，并核对所有fileModes条目的包、模块点数。
4. inventory内summary与独立summary逐字段相等。600唯一manifest文件、64,445行、server/client/shared范围汇总一致；无vite-cache/node_modules/.git条目。127模块点（118 import、2 dynamic-import、7 resolve）、277绑定（type165/value112）、100包内符号、155直接call/construct，与包表逐项核对。绑定/site/file、reference kind及图边成员关系合法。
5. 从保存的2247条localEdges重新求反向闭包 **153=94+59**，与全部保存的可达文件及summary相同；保存的parse diagnostics为空。未重新执行TypeScript AST扫描，不能称本轮重验了当前树AST诊断。
6. 全量解析正式生成MD：151矩阵行的每个语义字段和所有来源链接均等于JSON；附录94直接文件的分类/点数/包/全部能力ID逐行等于snapshot；100符号的包内集合、277绑定、165 type、112 value、155调用/构造及每符号全部来源文件逐项相同。8私有路径、2借用依赖、1计算式resolve及59间接文件亦完整。
7. capability-summary全部统计键、域、主责、状态、分类覆盖和hash均独立重算一致。主报告规模指标表、14域表、状态表、5主责表、包表、HEAD和版本与snapshot一致。主报告只声明manifest hash，未要求其额外声明matrix hash。
8. **14份MD、1609个本地链接出现项**（含audits）目标存在；检查非历史源码行锚点界限/Markdown标题锚点、围栏配对、表格列宽、合并冲突标记均通过。历史绝对源码行号不作为最终snapshot等同要求。本地链接仅验证存在/可解析，不请求网络或验证外链，也不是浏览器渲染检查。
9. [validation.md](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/validation.md) 的“最终独立检查进行中”按用户说明视为待填占位，已检查链接/格式，不算事实缺陷。本报告未替换该占位。

## Hash证据

- 源码manifest（由保存的600条path+NUL+sha256+换行独立重建）：`64c5a847b82947b8188deadf4b72be959e2af2853d196e4135b673964eb3da14`。
- capability-matrix.json实际字节SHA256：`3d117c9f13818ff03fe433c431cd0f41d8fcaa644cc39d96858c65b45ea215e9`。
- 上述hash均与正式summary、矩阵MD/附录及主报告中适用的hash声明相符。此处是保存快照自洽，不表示当前磁盘所有源码仍等于快照。

## 外部源码漂移与影响（未修复）

renderer在 [render-capability-inventory.mjs:43](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs#L43) 报manifest漂移：

- [app/src/server/usage-materialized-store.ts](/Volumes/D_Work/axiom2/app/src/server/usage-materialized-store.ts)。独立重算全部600条manifest亦仅发现此文件字节变化；当前代码文件集合没有新增/删除。
- snapshot：8210 bytes / 110行，SHA256 `3d76d41cace00560606da18b3c9cbb356f7bf81948a01ceec244e26a1195143d`。
- 核验时当前：8274 bytes / 112行，SHA256 `0ce7b0f049795e9233a058948edcabca29d7e421386849f982f51c4576e390af`。
- 对应 [capability-matrix.json:163](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/capability-matrix.json#L163) **U09 后台查询sidecar及物化缓存**。它不是94个直接Pi引用文件之一；不影响保存snapshot内94/94分类和100符号统计的自洽，但U09来源字节与当前工作树不再相同，不能声称当前树与正式manifest一致。
- renderer在写输出之前拒绝；**未生成临时三份产物，无法进行端到端summary复现/生成MD比较**。本轮以独立Python逐字段/逐行语义对照验证已保存产物，而非绕开renderer保护后伪造复现成功。

建议主代理协调外部变更所有者审阅U09影响；需要新的当前树产物时再统一协调重扫/重渲染并同步hash。不要仅改正式hash、不应覆盖本次snapshot来掩盖漂移。用户明确禁止本子任务修改正式snapshot，故未采取任何修复。

## 明确未验证

未执行产品或研究脚本行为测试、npm test/check/build、模型/Pi/DSH运行、网络、依赖安装、完整运行时调用图、业务语义逐项源码再审、外链HTTP、UI渲染、性能/并发/取消/崩溃恢复/迁移验证。scanner仅做node语法检查，图/符号/计数从保存snapshot独立重算；600文件hash比较是逐文件观察而非原子快照。renderer exit1保留为未完成的复现检查，不因静态断言通过而改报成功。
