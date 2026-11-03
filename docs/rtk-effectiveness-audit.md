# 内置 RTK 实效检查（2026-10-29）

## 结论

用户反馈属实：当前 RTK 已启用强力模式，主、子代理接入均正常，但实际覆盖率很低。主要问题是 Axiom 的保守命令适配与日常复合 shell 用法不匹配，不是程序未安装、开关未生效或结构化原文回灌模型。

本轮只做诊断与验证，未修改过滤实现、用户配置或安装，未重启后台。不能将字节缩减等同 token、请求总上下文或账单缩减。

## 实际运行快照

只读查询本机 `integrations/rtk/effects.sqlite`，未通过会清理数据的 `RtkService` / `rtkStats` 读取。安装为官方 OSS **1.0.1**，设置 `enabled=true / level=aggressive / subagents=true`。

以下是同一次查询取得的滚动 **5,000 条**快照，约覆盖一天。数据库达到保留上限，不能称为完整的七天或三十天统计。

| 结果 | 次数 | 输入文本字节 |
| --- | ---: | ---: |
| 命令或格式不支持 | 2,331 | 10,619,566 |
| 输出低于门槛 | 1,801 | 323,282 |
| 原工具出错 | 497 | 1,117,573 |
| 原输出已截断 | 307 | 1,822,853 |
| 已缩减 | 40 | 467,225 |
| 净缩减不足 | 23 | 193,100 |
| 非标准文本结果 | 1 | 5,332 |

- 观察输入 **14,548,931 B**，返回文本 **14,263,870 B**，净缩减 **285,061 B / 1.96%**。
- 按次数命中 **40 / 5,000 = 0.8%**。
- 命中结果自身净缩减约 **61.0%**。不是所有过滤器都没有能力，而是它们处理的输出仅占很小一部分。
- 不支持项占输入字节约 **73.0%**。没有 `failed`、`missing` 或 `nested` 记录；嵌套调用是实现边界，但不是这次快照的直接损失来源。
- 成功缩减：文件列表 17 次、搜索 17 次、Git diff 6 次。Git status 3 次均为 `unchanged`。

## 原因与边界

### 1. 命令适配和实际用法不匹配（首要原因）

[rtk-runtime.ts](../app/src/server/integrations/rtk-runtime.ts) 的 `literalWords` 拒绝多行、管道、重定向和多数复合命令；只额外允许简单 `cd … &&` 前缀。因此 `rg … && rg …`、`git status --short && git diff …`、常见 heredoc 脚本等不会过滤，即使它们包含支持的子命令。

对最近修改的 45 份会话 JSONL 做**命令与显示文本分类器回放**：647 条不支持输出中，按“多行 → 复合 → 管道 → 重定向 → 简单”的互斥优先级分类，复合命令 470 条、多行 93 条、管道 73 条，仅 11 条属于简单或字面量命令类别。这 636 条合计 3,014,427 B，占该回放不支持文本的 99.2%。

回放含会话分支历史，不与效果数据库使用同一分母；Pi 不持久化 `structuredContent`，故它**不是完整实时过滤资格重放**。完整聚合值见 [classifier-replay.json](evidence/rtk-effectiveness/classifier-replay.json)，不保存原命令和工具正文。

不应直接放开混合输出：最后一个命令不能代表前面所有输出的格式，错误地用搜索或测试过滤器处理混合内容可能丢失重要信息。更可靠的方向是单独工具调用，或在执行结果形成时保留可信的命令级分段，再分别过滤。

### 2. 支持的工具和测试格式偏窄

[rtk-runtime.ts](../app/src/server/integrations/rtk-runtime.ts) 只接入直接 `bash` / `powershell` 结果；Read、MCP、独立搜索工具和 nested/codemode 调用不处理。`npx` 等包装器只识别少数显式工具，不按任意项目脚本名推断内部执行内容。

项目常用的 Node / tsx `--test` TAP 格式明确不支持，见 [rtk.test.ts](../app/tests/rtk.test.ts)。强力模式只是扩充允许的命令集合、降低输入和净收益门槛，不是更强的通用摘要算法。对于不支持的命令，提高等级也不会产生效果。

### 3. Git status 是无收益接入

真实安装程序在隔离 HOME/RTK 状态环境下，处理 100 行合成 `git status --short` 输出：**3,590 B → 3,589 B**。再加原文回查提示后，必然达不到最低净收益门槛。实际快照的三次 status 也是全部 `unchanged`。合成样本结果见 [official-pipe.json](evidence/rtk-effectiveness/official-pipe.json)。

核对官方 [v1.0.1 git_cmd.rs](https://github.com/rtk-ai/rtk/blob/v1.0.1/src/cmds/git/git_cmd.rs) 的 `format_status_inner`（约 2119–2147 行），该 pipe 路径基本逐行保留输入，只对分支头做轻微格式化。因此“范围支持 Git 简短状态”不等于它能对大状态列表产生有意义的缩减。不要通过重新运行命令取得其他输出格式来修补，这可能读取到不同工作区状态。

建议取消这种已知无收益的子进程路径，或增加有明确保留规则、真实样本验证的专用状态摘要。单改此项不能解决总体低覆盖率。

### 4. 大输出在 RTK 之前已经被 SDK 截断

307 条截断输出占观察输入约 12.5%。当前接入点位于工具执行结束后，SDK 的显示输出限额已经生效；实现为避免对不完整文本作摘要而保留原结果。这是安全策略，但意味着最冗长的输出未必能受益。

若要处理，应在有完整原文、明确退出状态和可回查文件的边界进行过滤，再执行显示截断，而不是对显示尾部假称完整摘要。失败命令保持原文同样是当前设计，不宜为增加统计收益而隐藏错误。

## 已排除的故障

- **未启用或子代理没接入**：实际配置已启用，且 [agent-worker.ts](../app/src/server/agent-worker.ts) 的 inline extension 同时覆盖主、子代理，子代理 `noExtensions` 不取消宿主 inline factory。
- **保留 structuredContent 抵消节省**：Pi 1.4.0 的 `createToolResultMessage` 不将该字段写入模型 transcript；程序化调用需要它，不能简单删除。隔离增强 worker 测试验证下一次 HTTP 模型请求包含 RTK 摘要、不包含原文件列表或 `structuredContent`，主、子代理都通过。
- **标准 shell 返回契约整体不匹配**：当前 SDK 返回的 `output / truncated / exit_code` 与 runtime 条件一致，实际快照也只有 1 条 `contract`。
- **RTK 全部透传或无法执行**：真实 1.0.1 Vitest 合成样本 **1,850 B → 33 B**；文件与搜索亦有实际成功记录。

## 验证与局限

工作目录 `app/`，执行：

```sh
node --import tsx --test tests/rtk.test.ts tests/rtk-worker.test.ts tests/rtk-data-cleanup.test.ts tests/command-admission.test.ts
```

**退出 0，33 项通过、0 失败、0 跳过**。覆盖主/子 worker、配置变化、安全旁路、取消、原文保存和数据清理并发等；[regression.log](evidence/rtk-effectiveness/regression.log)。增强下一次模型请求测试另通过 1 项，见 [worker-provider.log](evidence/rtk-effectiveness/worker-provider.log)。

常规单元测试主要使用注入的假过滤器；通过这些测试不等于各类真实官方过滤器都有净收益，也不保证有损摘要保留所有语义。未做全仓测试、Windows/Linux 实机验证、真实 token/账单评估或全类输出语义质量评分。

## 改进优先级

1. **先处理覆盖架构**：减少把多个独立检查拼在一次 shell 调用；有需求时设计可信分段过滤，而不是放宽任意复合语法识别。
2. **补真实常用格式**：对 Node/tsx TAP、常用显式包装器建立严格的输入验证、计数/警告保留和失败回退测试，再扩充支持。
3. **消除无收益路径**：Git status 不能只做“支持”声明，应增加真实净收益验收或跳过无效调用。
4. **前移大输出处理并细化诊断**：分清语法不支持、工具不支持和格式不匹配；保留当前错误、结构化调用及原文回查安全边界。

不建议以重装 RTK、继续降低门槛，或关闭所有安全旁路代替上述改进。
