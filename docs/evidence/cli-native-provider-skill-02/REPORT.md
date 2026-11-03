# 原生 Provider 技能经验回写：通过

已更新 [cli-native-provider](../../../.agents/skills/cli-native-provider/SKILL.md) 的7个文件：主入口、架构/验证/案例参考、ONBOARDING/CASE-CONTRACT/HANDOFF模板。其余3个技能文件未改。范围见 [合同](CONTRACT.md)，改前10个技能原文与指纹保存在 [baseline](baseline.json)。

## 新增可复用内容

- **组件真正独立**：公共入口实际发射、分发依赖闭包、无宿主SDK/TS loader的plain runtime导入；实际adapter接回core，不以目录搬迁代替验证。
- **所有权与安全**：唯一刷新owner、存储revision和晚到回调、logout/dispose/流取消分工；工具候选不等执行许可，完整成功终态与严格schema、防coercion；原生事实与SDK展示/价格分离。
- **真实验收分层**：保护当前默认/代理，先核选模型接口副作用；独立SDK测试进程不等常驻服务加载或UI端到端。显式identity helper调用不证明worker自动注入。
- **有界实发方法**：metadata零网络预检、模型/认证/profile/目录/辅助预算、真正sender发送前门禁、import-safe harness、合成自测与源码/产物指纹绑定、终态和资源清理读回。
- Kiro具体版本、请求数及npm/Pi陷阱留在[案例参考](../../../.agents/skills/cli-native-provider/references/case-lessons.md)，链接原[离线报告](../kiro-native-component-01/REPORT.md)与[真实报告](../kiro-native-component-live-01/REPORT.md)，不把旧claim或参数当新授权。

另修正[组件说明](../../native-provider-component.md)末段：原“未真实OAuth/模型调用”现在明确仅指离线轮次，后续真实刷新/模型成功与仍未部署的限制分开。没有改写旧报告或生产源码。

## 新执行的验证

环境 Node22.23.2、Pi1.4.0；cwd为仓库根。使用安装版公开ESM入口，完整阅读对应README、skills/settings/packages/configuration文档；没有改node_modules。

| 检查 | 命令或证据 | 结果 |
|---|---|---|
| verifier语法 | `node --check docs/evidence/cli-native-provider-skill-02/verify-skill.mjs` | exit0 |
| 格式、引用、parser、发现 | `node docs/evidence/cli-native-provider-skill-02/verify-skill.mjs` | exit0；[完整JSON](verification.json)，[stderr](verification.stderr)为空 |
| Markdown | 10个技能文件+本case合同+组件说明 | 12文件、32本地链接实例，换行/代码围栏/空白检查通过 |
| Pi parser与发现 | 隔离HOME/agentDir/空settings，可信项目 | diagnostics=[]；repo与app两个cwd均唯一enabled自动发现；旧归档未发现 |
| 禁止外部副作用 | import前阻断fetch/http/https/socket/childProcess | 触发0；临时目录已删除；不是OS sandbox |
| 改动及旧证据保全 | baseline与当前SHA核对 | 7技能改动、3未改；36冻结文件一致；组件说明为合同明确允许的第37项例外 |
| 只读内容审查 | t12172/r12173已读回，主代理核当前报告/文件 | 六项建议采用；非自动语义证明 |

[验证器](verify-skill.mjs) stdout采用新文件且拒覆盖；本轮没有验证失败或修改被测文件后漏复验。最初定位旧脚本时误用不存在的 `verify.mjs` 得ENOENT，已改读正确的 `verify-skill.mjs`，未执行旧case。

交付前用 `git diff --check -- .agents/skills/cli-native-provider docs/native-provider-component.md docs/evidence/cli-native-provider-skill-02` 检查限定路径；[日志](diff-check.log)。`node docs/evidence/cli-native-provider-skill-02/final-check.mjs` 核报告链接及54个当前/loader/冻结指纹，结果见 [final-readback](final-readback.json)；未改变被测文件，不重复运行已通过的loader。

## 边界

本轮只更新技能/关联说明并离线检查，**未调用模型/供应商CLI、未执行旧harness、未构建/pack/安装、未重启或部署**。379项离线覆盖与3次真实模型请求均是历史结果，本轮没有重跑或重新计入。

当前会话自动热加载、用户HOME中的同名冲突、UI技能命令未验证；只证明安装版parser与隔离可信项目发现。链接仅查本地目标，不检查外部URL或片段锚点。原生重试、隐私变更、第二供应商仍不属于本任务授权。
