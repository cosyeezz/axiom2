# 内容走查：原生Provider接入技能

范围：文档层面的四条入口与六项关键分工；不是执行REA/供应商的结果。依据本轮读取的REA6.8.0技能及当前Pi1.4.0类型/loader行为。

| 输入场景 | 应进入的路线 | 文档落点/检查结论 |
|---|---|---|
| 官方文档/完整源码足够 | 直接协议矩阵与纯函数fixture，不跑REA setup | SKILL快速启动、rea-workflow第一节明确；满足 |
| 大minified JS/ASAR/启动器 | 绑定实际runtime/member，有界定位；缺口才AST；summary不减分析 | rea-workflow目标表/第3节，CASE-CONTRACT预算；满足 |
| 原生/managed CLI | 格式/架构/身份→engine能力→局部函数；宿主限制、伪代码/执行区分 | rea-workflow第2/3节、verification平台条目；满足 |
| REA不可用/超时/结果截断 | 区分连接、provider、client deadline、retained分页与cleanup；不无变化重试 | rea-workflow第4/5节；满足 |

关键覆盖：
- 认证注册/PKCE/device/刷新/持久化/退出、目录/profile/权限、推理及辅助链路全表；不会把推理UA等同全授权链对齐。
- 统一domain/events/capabilities、供应商隔离状态、注入存储与交互、每SDK薄适配；不是CLI/ACP或反代，不称所有SDK即插即用。
- run/invocation/attempt/tool/response身份分离；真实入口识别title/summary，重试owner防叠乘。
- caller cancel与资源settle分离、迟到Response/账号epoch、observer仅包装sender；安全保守差异显式报告。
- 合成→loopback→真实SDK→已授权live→部署分层；失败claim保留，修fixture可重验受影响离线范围。
- 四模板可从新供应商填写，不硬编码Kiro模型、scope、UA、预算或旧命令；只在案例参考引向Kiro冻结原件。

实现边界：主SKILL74行，5参考、4模板；方法细节按需读取。此走查是人工文档审阅，不是独立子代理评审或自动语义证明。当前环境先前子代理因缺API key不可用，未恢复/重派；结构/发现与diff检查将使用独立本地进程并行。

发现规范修正：当前Pi1.4.0的loadSkillsFromDir在目录含SKILL.md时返回该技能，不再递归子目录；无SKILL.md时递归找技能。因此归档放docs/evidence而非skill树的决定仍有助于明确历史边界，但不能声称该版一定会加载skill根下的第二个SKILL。实际发现以本轮验证为准。
