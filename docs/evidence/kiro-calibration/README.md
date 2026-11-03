# Kiro 校准清单的静态校对证据

对应[49项校准清单](../../kiro-calibration-checklist.md)、[逐项官方证据矩阵](../../kiro-omission-review.md)及[多轮收敛报告](convergence-review.md)。路线是Axiom/Pi控制agent循环、工具、权限、子任务和恢复，Kiro仅作原生provider，不接CLI/ACP。本目录不证明已修好、官方全对齐或服务可用。

## 当前交付

- [convergence-review.md](convergence-review.md)：完整三分区反证、主裁决、R1/R3/R5实质进展与R6/R7连续两零停止依据；K04待修/P0、K39待修/P1、K45/K07验收变化，以及K47/K49的独立边界。并行子审不是多轮；旧零轮不套新源。
- [convergence-source-baseline.json](convergence-source-baseline.json)：2026-10-27T02:36:28.493131Z已审77源字节观察；R6/R7轮末一致。审查期间源码未成功冻结，worker/agents/network及扩展热切证据由并行工作改变，不归本会话修复。
- [previous-source-baseline.json](previous-source-baseline.json)：更早15源实际工作树hash副本，不是clean commit；不含真实配置/凭据/历史。
- [verify-checklist.py](verify-checklist.py)：Python标准库校49项/49矩阵连续性、13/16/12/8处置、链接/行界、Pi版本、历史副本及77源精确一致；分开比较旧15/35/49/59源，明确已审并行变化白名单，不静默放行其他漂移。git只rev-parse/diff。
- [verification.json](verification.json)：最近一次文档/字节校对的实际时间、范围、退出条件和失败；当前链接数量以此为准，旧219/73不沿用。结构0失败不认证语义、官方行为、轮次裁决或业务可用。
- [chat-local-rea-index.json](chat-local-rea-index.json)：历史macOS CLI2.33.1 arm64 chat的11个局部函数与来源绑定；不是11/49覆盖率、官方源码、新REA或完整Evidence正文复验。
- [semantic-review.md](semantic-review.md)：历史独立只读审阅、主会话撤回/纠正及本轮语义复核；不是项目测试记录。

## 原字节历史

- [41项清单](../../kiro-calibration-checklist-41-items.md)与[结果](verification-41-items.json)：原观察41项、86链接、42链接文件、35源、旧15/15匹配；SHA由脚本固定保护。本次与旧35源匹配31处，三处热切变化及package已有entities依赖变化分开记录，Pi仍1.1.0。
- [48项清单](../../kiro-calibration-checklist-48-items.md)、[漏项报告](../../kiro-omission-review-48-items.md)、[结果](verification-48-items.json)：原观察48项/48矩阵、171链接/61文件、49源；本次旧49源46处相同。不是新运行测试。
- [改稿前49项清单](../../kiro-calibration-checklist-49-items.md)、[报告](../../kiro-omission-review-49-items.md)、[结果](verification-49-items.json)：原观察49项/49矩阵、15/14/12/8处置、219链接/73文件、59源/12支持文档；本次旧59源56处相同。副本SHA与此前正文/结果逐字一致并由脚本固定，不能把历史处置与数字改为本轮。
- 更早15源当前14处相同；当前九个Kiro provider相对HEAD无diff。所有匹配数是字节观察，不是通过率；本会话仅改审查文档、归档副本及文档校验脚本/结果。

## 运行纯文档校对

从仓库根目录：

```sh
python3 -B docs/evidence/kiro-calibration/verify-checklist.py
```

脚本不导入或执行Axiom/Pi源码，不运行单元/集成/live测试、构建、CLI/REA，不访问网络，不读取实际账号配置、凭据、登录缓存、聊天记录或秘密日志。仅写本目录verification.json，且再核观察期间源和受检文档未变化。修改相关文件后须重跑；源有未审漂移则先重核，不能仅更新期望hash。

用户当前不可用的根因仍未知；官方caller默认、认证/modelId/endpoint传递、最终发送、响应正文/terminal/签名续接未闭合。后续修复、离线mock和Axiom隔离真实对话分别授权，不能因文档验收完成提前使用登录态。
