# Kiro：通过 Axiom 真实调用

用户已配置模型并授权真实调用，要求使用 Axiom，不使用 Bash。本次模型请求由 **Axiom 的任务调度器 → agent worker → 原生 `kiro-chat` provider** 发起；没有终端直连 Kiro HTTP 请求，也没有用独立 Pi SDK 脚本替代 Axiom。

浏览器控制使用 OpenCLI，连接本机 Axiom `http://127.0.0.1:4317`，仅发送 Axiom 自身的同源 `/ws` 命令。PowerShell 仅承载浏览器控制和证据文件校验，不承载模型直连调用。

## 实际结果

模型均为 **`kiro / claude-sonnet-4.5`**。

| Axiom 思考等级 | 提示任务 | 实际最终回答 | 可见思考 | Axiom run 耗时 | 状态 |
| --- | --- | --- | --- | --- | --- |
| high | 17 × 19，只回复指定标记与结果 | `AXIOM_KIRO_OK 323` | 381 个 UTF-16 单元 | 7.507 秒 | completed，无 error/retry |
| off | 23 × 27，只回复指定标记与结果 | `AXIOM_KIRO_OFF_OK 621` | 本次未出现 | 5.733 秒 | completed，无 error/retry |

耗时来自 Axiom run 的开始/结束记录，包含应用层开销，不是纯 API 延迟对比。两次模型均未调用工具。

[脱敏调用记录](axiom-calls.json) 保留实际 run、会话、消息 ID，模型/等级选择、最终回答、思考长度和时间；未保存思考正文或凭据。[完整性记录](checks.json) 记录结果断言与文件 SHA256。

## 隔离与验证方式

- 先用 Axiom `delegate` 创建一个只回复 READY 的准备子会话；该准备响应不算作 Kiro 验证。
- 在准备完成后，经 Axiom `agent.model` 仅切换该子会话为 Kiro/high，再由 Axiom `append` 发起第一轮；完成后切为 off，第二轮同样由 `append` 发起。
- 核对每次实际 `run.selection`、completed/error/retry、对应消息的 `runId` 和最终回答；不是根据模型自称确认身份。
- 子会话在 Axiom `tasks` 表登记，`agent.model` 的子会话分支不写主模型全局默认；也没有修改全局子模型默认，读取前后值一致。没有改动用户其他会话、模型配置或源码。
- 使用新建的自有后台浏览器会话，完成后已释放 tab lease；测试子会话和结果保留，可在 Axiom 内核对。

## 结论边界

这证明当前已配置账号/端点下，Sonnet 4.5 的 Axiom 文本调用在 high/off 均成功，high 可见思考解析有效。它不证明所有模型、等级、区域或账号都可用。

该模型在当前适配器中为 budget 模式，high 默认 20000 是本地请求政策，不是此次测得的服务端硬限制。用户配置中手动开放的 xhigh/max 不属于此模型已实现的预算档位，本次未采用或修改；不可将通用 UI 可见选项误当成协议支持。off 的这一次没有可见思考，不等于承诺服务永远不自行推理。

未做真实图片/工具调用、费用核对、全部等级测试或同账号官方 CLI 对照；这些不能从本次文本实调推导。此前离线专项 82/82、通用 38/38、类型/构建与协议探针记录仍独立保留，本次未改源码，不重复无影响的已通过检查。
