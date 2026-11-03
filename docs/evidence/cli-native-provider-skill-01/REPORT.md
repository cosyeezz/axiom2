# CLI原生Provider技能迁移：已完成

已将Kiro个案技能通用化并更名为 **cli-native-provider**。内容、当前Pi解析/发现与历史保全检查通过；这是技能资料交付，不是新的Provider实现或真实模型验收。

## 交付

- [主技能](../../../.agents/skills/cli-native-provider/SKILL.md)：74行，7阶段流程，从目标绑定到认证/协议还原、独立核心、SDK适配、验证及交付。
- 5个按需参考：REA定位/证据与恢复、认证协议还原、Provider架构、验证与运行安全、个案提炼。
- 4个模板：[接入工作单](../../../.agents/skills/cli-native-provider/templates/ONBOARDING.md)、[协议矩阵](../../../.agents/skills/cli-native-provider/templates/PROTOCOL-MATRIX.md)、[case合同](../../../.agents/skills/cli-native-provider/templates/CASE-CONTRACT.md)、[交接清单](../../../.agents/skills/cli-native-provider/templates/HANDOFF.md)。全部技能资料共10文件、624行。
- [内容走查](CONTENT-REVIEW.md)覆盖完整源码、JS包、原生目标、REA不可用四条入口与关键分工。它是人工审阅，不是独立代理评审或自动语义证明。

REA方法来自已安装6.8.0技能（metadata version49）；仅整合相关工作流，未改安装版REA。真实操作仍按当前server schema，不照抄未公布参数；普通源码任务不以REA为前置。

## 验证结果

遵守[本轮合同](CONTRACT.md)，新[验证脚本](verify-skill.mjs)与限定diff检查并行，测试期间未修改被测文件。Node为实际使用的已安装v22.23.2；下列node指该可执行文件，非另行安装。

| 检查 | 命令与结果 |
|---|---|
| 新技能结构/发现/保全 | 仓库根目录执行 `node docs/evidence/cli-native-provider-skill-01/verify-skill.mjs`，exit0，约0.2秒；[完整结果](verification.json)，stderr为空 |
| 格式与链接 | 10技能文件+2普通文档+3本轮说明，15份Markdown；主验收66个本地链接实例通过，代码围栏/结尾/空白/私有路径基础检查通过 |
| Pi真实解析器 | 当前Pi1.4.0，diagnostics=[]；新name与目录一致，prompt formatter包含正确入口 |
| 项目发现 | 隔离HOME/agentDir、内存settings、trusted project；repo与app两个cwd均auto发现且enabled，新名称唯一，归档未自动发现 |
| 历史保全 | 6归档文件SHA及bytes与操作前快照、旧冻结manifest一致；3份冻结transition文件SHA不变 |
| diff | `git diff --check -- .agents/skills/kiro-native-parity-evidence .agents/skills/cli-native-provider docs/kiro-auth.md docs/kiro-macos-handoff.md docs/evidence/cli-native-provider-skill-01`，exit0；新未跟踪Markdown另由脚本检查格式 |

网络/子进程JS防护触发数0；未加载extension、供应商模块或旧harness。没有使用模型子代理；先前缺API key的子代理未恢复或重派。主要测试一次通过，无新的失败实验。

随后只整理本报告；未改变已通过的技能、普通文档、脚本或历史文件。报告增加链接后的格式/链接复核另存 `final-links.json`，执行退出码及索引见 `verification-summary.json`；不重新计数或声称重跑全部发现检查。

## 历史保全与引用边界

旧6文件从 `.agents/skills/kiro-native-parity-evidence` 原字节移到[legacy入口](legacy/kiro-native-parity-evidence/SKILL.md)，保留目录形状、内部参考、所有旧失败与停点。[source-snapshot.json](source-snapshot.json)提供每个原路径→归档路径→SHA。归档不是当前执行计划；原路径字符串与旧验证脚本依赖当时目录语境，不应执行旧脚本/claim。

`docs/evidence/kiro-macos-transition/{README.md,verification.json,verify-skill.mjs}`保持原字节；旧Pi1.1.0验证不转述为新技能验证。普通[Mac交接](../../kiro-macos-handoff.md)和[认证说明](../../kiro-auth.md)已迁移引用并标注历史语境，没有改写旧实验结果。当前旧canonical路径引用仅存在于归档、迁移映射及冻结证据中。

## 验证边界

- 未修改生产、依赖、REA安装或全局安全配置；未执行官方CLI、真实模型、采集、REA分析、部署、重启或旧case。
- Pi发现通过不等活动会话已热加载；用户/home冲突与外部URL可用性未验。无需为本次文档变更重启后台。
- JS防护不是OS网络审计；路径/格式扫描不是完整secret审计。原件保全以字节指纹为准，不把历史运行结论改标为当前平台结果。
- 通用核心参考和模板可单独复用；案例参考中的仓库外链依赖本仓库证据，不应为补案例而执行旧脚本。
- 原Kiro生产retry与完整parity仍按原授权边界等待，不因本次技能交付而恢复实施。
