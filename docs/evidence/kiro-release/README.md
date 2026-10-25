# Kiro 合并发布验收

本目录独立记录将本会话完整 Kiro 实现合入远端 `master`（基线 `7aee7a9`）后的验证，不替换前面各阶段的原日志、失败记录、SHA 或结论。原工作区存在其他会话并行改动，因此使用独立工作树整合；仅纳入本会话 Kiro 生产链、对应 UI 文案、测试、文档与证据。

## 推送前的 master 再整合

初次验收及实现提交为 `6b929cc`。推送前远端又前进 4 个提交至 `c27cf94`，涉及 63 个桌面安装/客户端发布/UI/测试与 OpenCLI 集成路径，和本次 Kiro 文件无交叠；已正常无冲突合并并保留双方历史。Kiro 与通用兼容测试的被测模型/worker 源码及测试文件均未改变，因此保留本页已通过的 82/48 结果，不无意义重复。最新整合另做完整/server 类型检查、实际生产构建及定向 OpenCLI 离线测试，结果见[最新 master 验收](master-refresh/README.md)。本页下列原始记录、检查结果及其基线仍为初次 `7aee7a9` 阶段；不覆盖为新阶段冒充重测。

## 合并范围

- 原生账号目录、聊天与正式工具调用、图片、思考等级，以及 Kiro 独立连接池策略；保留最新 `master` 已有的授权退出界面等改动。
- 共享 `model-service.ts` 只纳入 Kiro 必需部分：排除其他会话的 Qoder 文案，`contextWindow` 零值转未知只作用于 Kiro，不改变其他供应商。
- 五个后来被其他会话修改的同名文件，已从本会话自身工具记录中按字面量重放到隔离产物，完整 SHA 与本会话阶段证据匹配后才恢复到交付树；没有执行历史代码或改写原工作区。随后只为文档增加准确的阶段边界与实调链接，没有混入其他会话的请求语义或实调脚本。
- `.gitattributes` 为 Kiro 证据保留原始字节，禁止行尾转换；CRLF 捕获视为合法，原日志不做空白清理。27 份被全局 `*.log` 忽略的历史日志（包括空日志）按明确路径收录。冻结清单仍为 79 文件、3,141,440 字节。

## 本次验证记录

| 范围 | 本次运行及日志 |
| --- | --- |
| Kiro 与保存/选择专项 | [命令、UTC 始末、退出码](focused-run.json)、[完整日志](focused-tests.log)；82/82 通过 |
| 14 个通用模型兼容测试文件 | [运行元数据](compatibility-run.json)、[完整日志](compatibility-tests.log)；48/48 通过 |
| 完整 TypeScript | [元数据](01-tsc.metadata.json)、[日志](01-tsc.log) |
| server TypeScript | [元数据](02-tsc-server.metadata.json)、[日志](02-tsc-server.log) |
| 实际 `npm.cmd run build` | [元数据](03-npm-build.metadata.json)、[日志](03-npm-build.log) |
| 发布完整性 | [检查脚本](check.cjs)、[结果与 SHA](checks.json) |

通用兼容首轮受工具 60 秒超时中断，不计为通过；[中断记录](compatibility-interrupted-metadata.json)、[stdout](compatibility-interrupted-stdout.log)和[stderr](compatibility-interrupted-stderr.log)保留。随后独立进程完整重跑 48/48、退出 0；[完成时 stderr](compatibility-stderr.log)为空。该次日志捕获中的控制台装饰符出现乱码，但测试名称、ASCII 计数和真实退出码完好；原样保留，检查器明确兼容这一装饰符，不改写原日志。

类型检查和实际构建均退出 0；Vite 转换 2573 个模块。大于 500 kB 的 chunk、`PLUGIN_TIMINGS` 为警告/性能提示，不是失败；PowerShell 对 stderr 的 `NativeCommandError` 包装不替代真实进程退出码。

完整性脚本重新核验原 thinking 检查器的断言，但仅在内存截获其生成报告，断言后校验原报告未变化；旧报告中 82/38 等数字仍只代表原历史运行，不挪作本次通用兼容测试的结果。然后独立检查本目录新日志、退出码、所有 Kiro Markdown 本地链接，以及 Git 索引内的冻结清单和本次范围逐文件 SHA，防止 `git add` 的换行转换或日志忽略破坏证据。索引检查同时要求待提交字节与被验证工作树一致。检查器不请求模型，也不执行官方 CLI 或参考项目。

从仓库根目录，在依赖与生产构建产物就绪、这些文件已在 Git 索引中时运行：

```text
node docs/evidence/kiro-release/check.cjs
```

这些记录来自 Windows、Node 24.19.0、Pi 1.1.0；元数据保留实际运行的绝对工作目录。历史静态研究脚本还依赖原机器的 CLI/dumpbin 路径；本目录不承诺干净克隆无需安装依赖、构建或准备原研究环境就能复现所有历史步骤。目录中的空类型日志代表该命令未输出诊断，不应被遗漏。

## 线上验证边界

本次合并验证全部为离线 mock/回环测试及构建，没有新增付费或受保护模型请求。此前已按用户授权通过 **Axiom 自身调用链**完成 Sonnet 4.5 文本 high/off 各一次，[独立证据](../kiro-live/README.md)保留实际结果、选择、run ID 和耗时，不保留思考正文。不能外推到图片/工具实调、所有模型/档位、预算硬限制、计费或与官方 CLI 完整等效；Sonnet 4.5 的 xhigh/max 本适配未接通，也未实测。
