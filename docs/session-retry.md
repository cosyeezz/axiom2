# 会话自动重试

Axiom 主会话和子会话的默认自动重试预算是 **额外 9 次**（首次请求不计入，连续失败最多 10 次模型请求）。每次失败后的等待依次为：

| 重试 | 本次等待 |
| --- | --- |
| 1–5 | 2、4、8、16、32 秒 |
| 6–9 | 2、4、8、30 分钟 |

九档累计等待 45 分 2 秒，不含请求耗时。成功响应后重试计数清零。会话环境的程序预览和实际快照均展示这组时序；运行提示使用原生事件的真实次数与截止时间。

## 边界与配置

- 仍由 Pi 判断可重试错误：超时、临时网络／服务错误等可以重试；认证、参数、明确额度／账单耗尽等不因此重试。上下文溢出仍走原生压缩恢复。
- 等待可通过现有“停止”取消，不新增外层请求循环，不重做已保存的工具结果。
- 尊重全局／可信项目／运行时显式 `retry.enabled`、`retry.maxRetries`。只配置次数时，沿用九档时序；超过九次的显式预算保持最后一档等待。
- 显式设置 `retry.baseDelayMs` 或 `retry.maxAgentDelayMs` 时，保留 Pi 原有指数退避和上限，未配置的次数仍默认九次。已有短延迟测试／自定义配置不被强制改成分钟等待。
- 供应商内部重试、独立压缩摘要／分支摘要的重试策略保持原配置，不叠加九档会话重试。
- 不延长子任务墙钟预算，也不绕过撤权、停止或服务退出。长退避仍占用执行租约。
- 后台重启会中断活动执行。手动恢复开启新的重试周期，不承诺保存原重试序号或剩余退避时间。

## Pi 兼容边界

实现位于 [session-retry-policy.ts](../app/src/server/session-retry-policy.ts)，绑定 Pi **1.4.0**。该版本没有延迟数组 API，宿主只桥接 `_willRetryAfterAgentEnd` 和 `_prepareRetry` 的同步设置读取；将当前档的 base/cap 都设为目标延迟后，仍由原生执行错误分类、预算、历史投影、事件、可取消睡眠与续跑。getter 在原方法返回 Promise 时立即恢复，不持有到等待结束，也不改变摘要策略。

升级 Pi 时必须重新核对这两个方法的读取顺序和首次 await 位置；版本／方法不符会明确拒绝安装适配，不静默回退或修改 `node_modules`。

## 验证

[session-retry-policy.test.ts](../app/tests/session-retry-policy.test.ts) 使用真实 AgentSession 与假时钟，验证九档精确截止时间、9 次耗尽／10 次请求、成功清零、30 分钟等待取消、错误分类、显式覆盖、reload 和原生摘要隔离。无个人凭据，不等待真实 45 分钟。

[native-retry.test.ts](../app/tests/native-retry.test.ts) 通过临时目录、loopback 模型服务和真实工作进程验证默认策略接线、显式短退避、工具不重做、追加输入、手动恢复及停止；[session-environment.test.ts](../app/tests/session-environment.test.ts) 验证预览／运行一致。

[session-environment.check.ts](../app/tests/session-environment.check.ts) 使用隔离临时环境与浏览器验证完整九档文字和 320／1440 px 换行无溢出。可通过 `AXIOM_TEST_BROWSER` 指定本机浏览器，无需个人 profile 或模型请求。
