# 持久用量旁路验证

本次验证使用临时数据根、合成账务、随机服务端口和模拟上游，不调用付费模型、不完成真实 OAuth，也未重启或部署生产后台。工作目录为 `app`。结果仅适用于本次代码和本机 fixture，不是生产时延或资源上限承诺。

## 功能与构建

- `npm run build` 通过，含客户端类型检查、Vite 和服务端编译。
- 86 个不同的相关单元用例通过：ledger 27、query-cache 3、sidecar 12，以及 analytics、page-state、字段、日期、额度估算、兼容 statistics、模型名称和 Costs 的 44 个用例。sidecar 在两次测试集中均执行，但这里不重复计数。
- `tests/provider-usage.check.ts` 通过完整仪表盘测试：五种宽度、初建“—”、全量图表、筛选、分页、共享快照、迟到响应、隐藏/重连及模拟认证。
- `tests/provider-quota-estimate.check.ts` 通过：两采样窗口、异步物化、手动刷新、来源竞态和水位检查。
- `tests/provider-requests.check.ts` 通过：当前后台请求监控、独立范围、失败与陈旧状态、可见性和窄屏。
- 对本次相关文件的 `git diff --check` 通过。测试前后源码散列核对中只有预期的 `ModelUsage.tsx` 分页修正发生变化，修正后重新构建并通过仪表盘和生产性能测试。并发工作树中的其他功能不属于本次隔离保证。

分页回归中曾发现：第二页尚未物化时的 `pending` 占位令牌覆盖了正式快照，导致后续请求触发跨代保护而回到第一页。现仅在报告存在已确认水位（或旧协议无 background 字段）时保存正式快照；完整翻页回归已通过。

## 生产资源加载性能

命令：

```sh
AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  npx tsx tests/usage-performance.check.ts
```

使用已有生产构建，后台准备与前端读取分别计时；该轻量 fixture 不是 2 万条冷聚合基准。

| 指标 | 毫秒 |
| --- | ---: |
| 后台准备（独立计时） | 5.299 |
| 冷页面 shell | 100.734 |
| 准备完成后首次数据展示 | 51.443 |
| 5 次热重进 P50 / P95 | 28.479 / 42.123 |
| 请求监控 click→rAF | 20.400 |
| 监控自动化端到端 | 40.721 |

热重进原始样本：30.494、26.381、28.479、42.123、25.912 ms。历史报告读取 6 次，官方上游读取 0 次。所有性能断言通过。

## 2 万条实际 worker 压力

一次性 `/tmp/axiom-usage-sidecar-stress.mts` 使用生产默认片间休眠 50 ms、启动延迟 1 秒，以及实际 `UsageSidecar` 子进程。父进程同时运行 10 ms 心跳和每 50 ms 一次的源 Store 更新；资源采样通过异步 `ps` 完成。该 fixture 单独运行，未与浏览器基准并行。

准备 20,000 行、已知费用 200 USD，耗时 **43,781.754 ms**。刚好达到现有 20,000 行边界时保守标记 `partial=true`，警告“当前不是全部历史”，不能把它当作无上限历史完整性证明。

| 指标 | 样本数 | 中位数 ms | P95 ms | 最大 ms |
| --- | ---: | ---: | ---: | ---: |
| 已准备报告的 IPC | 100 | 0.357 | 0.452 | 0.597 |
| 父心跳超出 10 ms 的调度延迟 | 3,796 | 2.021 | 2.179 | 7.915 |
| 父源 Store 写入总耗时 | 859 | 0.180 | 0.751 | 4.205 |

worker 观测 nice 始终为 19；最大采样 RSS 为 293,904 KiB（约 287 MiB），最大采样 CPU 为 92.9%，重启 0 次。关闭前 ready、pending=0；关闭后确认自有 worker 已退出。关闭后派生 DB/WAL/SHM 合计 52,137,984 bytes。

实际 worker 关闭后，另行对同一持久代次测量同步操作，**不与上表隔离运行期间的父进程延迟混淆**：

| 同步诊断操作 | 毫秒 |
| --- | ---: |
| 20k analytics UTC | 275.993 |
| 20k analytics Asia/Shanghai | 257.070 |
| 20k analytics America/New_York | 256.317 |
| 对应 100 行报告 JSON 序列化 | 0.226 / 0.158 / 0.162 |
| 20k 兼容 statistics 汇总 | 148.753 |

## 隔离结论与限制

本次旁路只在服务启动/关闭和统计查询处接入。模型调用、消息保存和压缩完成路径未新增统计计算、派生写表、通知或等待；worker 独立读取既有落盘来源，故障没有主进程同步扫描 fallback。单元测试还覆盖真实子进程挂起、退出、重启、有界 IPC、源写入继续及关闭。

这是**执行依赖隔离**，不是物理零竞争：nice19 不等于 CPU 配额，256 MiB V8 堆上限不等于 RSS 上限，WAL checkpoint 后保留目标不等于活动 WAL 硬上限；单次 SQL/JSON 不可在软 15 ms 预算处强制抢占。本次父进程测量不是实际模型端到端时延的 A/B 对照，也不能保证所有机器或极端压力下绝无影响。

原始日志与 JSON：`/tmp/axiom-usage-sidecar-{unit-v2,regressions-final,dashboard-v2,quota-final,monitor-final,build-final2,performance-final,stress}.log`、`/tmp/axiom-usage-performance.json`、`/tmp/axiom-usage-sidecar-stress.json`；最终相关源码散列 `/tmp/axiom-usage-sidecar-source-verified.sha256`。这些临时文件可能在重启后清理，本页保留本次结论、范围和测量结果。
