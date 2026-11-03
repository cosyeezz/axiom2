# CLI原生接入技能：历史提炼交付

## 结果

已按用户顺序先整合抓包，再将当前/历史Kiro主会话与正式报告中的踩坑、复用和提效方法写入 [cli-native-provider](../../../.agents/skills/cli-native-provider/SKILL.md)。这是技能交付，不是新供应商实现或当前Kiro完整对齐认证。

- [抓包参考](../../../.agents/skills/cli-native-provider/references/capture-comparison.md)：mitmweb/OpenCLI、进程局部CA、正常UI/SDK与官方CLI、RAM flow差集、比较矩阵及恢复；保留[完整历史流程](../../cli-native-capture-comparison.md)。
- [快速路径](../../../.agents/skills/cli-native-provider/references/fast-paths.md)：新接入最短纵向闭环、17类症状到最短检查、前置诊断、证据复用、预算退出、快照/claim、默认恢复。
- [Kiro版本化教训](../../../.agents/skills/cli-native-provider/references/kiro-lessons.md)：认证/企业profile、目录全契约、thinking schema/off、全工具Schema、CLI先行SSE语义、上下文/图片、observer、重试/缓存、harness/分发/部署；各组附原报告和旧结论替代关系。
- 主入口、协议、架构、验证、案例索引及四模板同步；八准则保留，澄清“禁止额外宿主身份注入”不等删除用户真实上下文中的路径/名称。REA参考保持原文，没有把关闭状态当运行授权。

没有删历史原件，没有把Kiro参数搬成通用供应商规格。技能目录此前整体untracked，本轮未提交，也不把目录内全部已有内容归为本轮新增。

## 核验

仓库根目录执行：

```bash
node --check docs/evidence/cli-native-provider-history-02/VERIFY.mjs
node docs/evidence/cli-native-provider-history-02/VERIFY.mjs
git diff --check -- .agents/skills/cli-native-provider docs/cli-native-capture-comparison.md docs/evidence/cli-native-provider-history-02
```

均exit0。[只读验证器](VERIFY.mjs)使用实际安装Pi1.4.0的loadSkillsFromDir/loadSkills/formatSkillsForPrompt：发现1技能、0诊断、description777字符、位置可进入prompt，显式路径发现通过。13个技能Markdown均从入口可达，81条技能本地链接及历史流程6条链接存在，围栏/行尾通过；1外部URL未访问。因技能整体untracked，空白检查主要由验证器覆盖，不把git diff无输出当唯一证据。

附加8准则/6文件模板挂钩检查最终exit0。初次把全篇编号粗体当八准则计数、再把正确的“分列”误要求为“分层”，均是checker/oracle错误；修检查范围/词项后通过，未为满足它们改技能。这些词项检查不是语义证明，另已人工核对授权、caller保真、CLI语义、handoff例外、版本替代和模板闭环。

[验证结果与文档指纹](verification.json)保留检查范围、失败原因与限制。未改变的旧生产592项等测试仅作为历史证据引用，没有在本轮重跑或累计。

## 范围与未解决项

本轮未改Provider生产代码，未实发、抓包、修改代理/CA、启用REA、构建重启或验证UI热加载；未复制凭据或持久化敏感原文。主研究由主代理完成，两次只读研究委派均模型失败、无可用结果，不作为证据。

源码读回发现当前Kiro的extraHeaders仍只是部分保护名称、payload guard主要检查身份字段，**不等本技能完整协议白名单已落地**；请求侧原生thinking历史回放、完整实验路由/官方重试、长会话Opus400等也未由本次解决。新增负例/正例在技能中是未来实现验收要求，不冒充已运行代码测试。

当前文档目标已完成，无活动测试/后台任务或清理依赖；后续Provider实现或真实验收须另按当前授权与新case执行。
