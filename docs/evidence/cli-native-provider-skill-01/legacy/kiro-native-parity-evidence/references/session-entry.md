# 最新接手入口：转向macOS原生CLI

用户已明确：**提交现有Kiro工作进展，随后基于macOS版Kiro CLI继续比对并完成剩余工作；不依赖付费Hopper。** 这更新了原Windows交接的“先完成controller02/supervisor02”顺序，原Windows证据与失败状态保留，不覆盖、不自动重跑。

1. 在仓库阅读`docs/kiro-macos-handoff.md`：当前路线、范围、基线门禁与剩余验收。
2. 阅读[通用Skill](../SKILL.md)，尤其“核心指导：先定位，再局部分析”。
3. 阅读[Mac原生路线](macos-native.md)与[Windows历史摘要/来源SHA](windows-evidence.md)。
4. 核实际Git提交、当前改动和产物身份；先Mac小控制与局部静态，再设计非模型观察，最后才真实请求对比。

此Skill以`.agents/skills/kiro-native-parity-evidence/`随Git携带，可直接read。Pi支持项目Agent Skills发现，但Axiom当前会话是否加载还需核实际资源目录/选择；用户目录若有同名旧版会产生优先级/冲突，不靠改名字或重启已Abandoned服务掩盖。可比较文件SHA后在授权范围同步用户级副本，勿覆盖用户自改内容。

仅本次Windows上文件/测试验证不等Mac实测。当前Mac宿主、CLI实际版本/架构和新官方基线尚未提供。原目标仍为Axiom/Pi原生直连、指定deepseek-3.2、多场景服务器可观察行为不可区分，尚未完成。不读/复制CLI凭据，不恢复旧Failed/Abandoned，不执行Windows危险归档；此文不自行授予跨用户或跨环境权限。
