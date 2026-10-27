# Pi 原生压缩兜底

Axiom 的异步压缩与 Pi 原生自动压缩独立运行：

- Axiom 保留用户设置（默认开启，100,000 Token 与模型窗口 80% 取小值）。
- Pi 原生阈值固定为当前模型窗口的 70%。Pi 使用严格大于判断：32,000 窗口在 22,401 Token 触发，而非恰好 22,400。
- 原生阈值通过 `native-compaction-policy.ts` 适配 Pi 公共 `getCompactionSettings()`：`reserveTokens = window - floor(window * 70 / 100)`。随模型切换、工作进程复用及资源重载实时计算，不修改 SDK 安装文件或持久化模型派生值。
- Pi 自身的 `compaction.enabled` 和 `keepRecentTokens` 设置仍有效；Axiom 界面的自动压缩开关不关闭 Pi。当前有效模型容量未知时跳过原生压缩检查。
- 主会话不再取消原生 `threshold` 和 `overflow` 压缩；手动压缩仍走 Axiom 入口。原生成功会更新上下文、用量并触发既有的记忆重读提示；失败会显示告警。
- 若 Pi 在后台摘要期间先完成压缩，旧 Axiom 摘要会作废，不能覆盖新的原生摘要或重新放大上下文。

两套机制不是“只有 Axiom 失败才启动 Pi”：小窗口可能先触发 70% 的 Pi；较大窗口通常先触发 Axiom 的 100,000 Token 上限。Pi 检查发生在其会话生命周期边界，不是独立常驻监视器。两者通常使用同一会话模型；网络、凭据或模型本身不可用时，原生兜底也可能失败。

`reserveTokens` 同时影响 Pi 摘要的输出预算（仍受模型最大输出限制），不是纯百分比参数。默认保留最近 20,000 Token，小窗口的压缩降幅可能受此保留量限制。

验证见 `native-compaction-policy.test.ts`、`auto-compression.test.ts`、`compression-context.test.ts`。后端代码需构建并重启后台才能可靠应用到已存在的 worker；会话资源 reload 不会重新加载 worker 模块。
