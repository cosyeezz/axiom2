# 本轮研究交付验证范围

> 仅静态研究工具、数据和文档验证；不代表产品测试、FakeAdapter或DSH集成通过。

## 已有证据

- 统计器实际执行exit 0；独立文本对照94文件/127字面模块点/277导入绑定/100包内符号一致，600代码文件集合与字节SHA匹配；独立重算语法闭包153，核实vite-cache为零manifest条目。
- [统计器独立复核](audits/scanner-review.md)及[文本](audits/independent-text-check.json)/[图](audits/graph-and-scope-check.json)保留全部范围与限制。该复核早于最终snapshot，不是持续监视磁盘的原子保证。
- 最终scanner与renderer实际运行成功；来源变更会被renderer拒绝，主代理审阅两个外部变化的费用sidecar文件后重新生成，未修改业务。
- 矩阵核实151项/14域、ID唯一、来源存在；全部15个非live及每域至少一项live经独立源码抽查。phase来源与observer字段两处事实措辞已修订，并经独立定点复核关闭。
- 151项状态：live136 / partial8 / helper1 / gap2 / new4；主责：runtime40 / archive23 / resources14 / model17 / host57；163来源文件，94/94直接引用文件有分类。

## 最终文档与数据检查

最终检查完成，范围限于研究脚本、保存快照、数据与文档；不运行npm test/check/build或模型，不验证底层SDK行为。

| 实际命令（仓库根目录执行） | exit | 结论 |
| --- | ---: | --- |
| `node --check docs/evidence/agent-runtime-capabilities/scan-pi-coupling.mjs` | 0 | 研究统计器语法有效；刷新后脚本字节未变，未重复检查 |
| `node --check docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs` | 0 | 研究renderer语法有效；刷新后脚本字节未变，未重复检查 |
| `python3 /tmp/axiom-runtime-final-recheck/verify.py` | 0 | 新snapshot实际重跑837项断言全通过；151项/14域、163来源、94/94分类、94文件/100符号附录和全部汇总一致 |
| `python3 /tmp/axiom-runtime-final-recheck/supplement.py` | 0 | 20项更新/差分检查通过；结构数据及matrix未变，契约两段TS逐字节相同 |
| `node docs/evidence/agent-runtime-capabilities/render-capability-inventory.mjs /private/tmp/axiom-runtime-final-recheck/rendered-realpath` | 0 | 临时重渲染成功；由下面的比较wrapper调用，不是额外再运行一次 |
| `python3 /tmp/axiom-runtime-final-recheck/render-and-compare-realpath.py` | 0 | 14项复现检查全通过；summary字节一致，两份MD规范化相对链接目标后全文一致且实际链接有效 |

- 最终manifest：`9f42b477d57636707e0e1d2a078fee8f33357a1504d89e4f7931f8e80043dd78`；600代码文件/64,447文本行。matrix SHA256：`3d117c9f13818ff03fe433c431cd0f41d8fcaa644cc39d96858c65b45ea215e9`。
- [刷新后完整报告](audits/final-recheck/report.md)及其[命令与真实退出码](audits/final-recheck/commands.json)、[837项结果](audits/final-recheck/results.json)、[差分结果](audits/final-recheck/supplement-results.json)、[复现结果](audits/final-recheck/reproduction-results-realpath.json)已归档。正式文档检查覆盖当时14份MD/1609个本地链接出现项；后续仅补本验证页、复现说明及审计归档；`python3 /tmp/axiom-runtime-final-targeted-check.py`实际exit 0，定点检查6份MD的格式/本地链接及两轮静态审计的54份归档副本（含9份JSON解析），无错误。最终记录见[结果](audits/final-publication/axiom-runtime-final-targeted-results.json)及[日志](audits/final-publication/axiom-runtime-final-targeted-check.log)。
- [整体边界审阅](audits/final-contract-review.md)无新增阻断；三处非阻断建议已修改，并由[定点复核](audits/final-contract-recheck.md)确认：脏树限制、宿主授权权威、压缩单写者提交协调。完整ID到接口族的交叉索引仍可后续细化，当前151项已有逐项port，不代表SDK冻结。

### 保留的失败及恢复事实

1. [首次检查](audits/final-static/report.md)的837项断言通过，但renderer **exit 1**：外部`usage-materialized-store.ts`从110行变112行，来源漂移保护正确拒绝。主代理审阅其constructor失败时close DB的清理变化，确认不增加Pi依赖且U09主责不变；完整备份旧64c5快照后重扫/重渲染并同步主报告。刷新后没有来源漂移，不能把首次失败写成成功或把旧837结果冒充新snapshot结果。
2. 刷新后首次临时renderer本身**exit 0**，但比较wrapper **exit 1**：macOS逻辑`/tmp`经符号链接落到`/private/tmp`，生成MD相对链接错误。改传物理绝对路径后renderer及比较均exit 0，14项复现检查全通过。正式项目MD不受此问题影响；研究脚本仍有该符号链接目录限制，复现说明已注明。两组真实结果均保留，不隐藏失败。
3. 这是逐文件观察，不是原子快照或持续监视。审计归档保留原运行环境绝对路径，临时渲染副本仍保留在原`/tmp`目录；仓库归档包括完整报告、命令、校验脚本、结果及日志。

## 明确未验证

没有真实模型、Pi/DSH运行、登录授权、取消/并发、队列竞争、进程树清理、磁盘fsync/崩溃恢复、性能/CPU/RSS/IO或线上数据迁移验证。源文件存在、AST可解析及分类映射不代表这些行为通过。详见[主报告](../../agent-runtime-capability-inventory.md)。
