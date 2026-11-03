# 启动门禁失败：未开始产物扫描

`/usr/bin/python3 .../v3-locate-01/locate_v3.py`实际exit **1**，在第14行执行 `resource.setrlimit(resource.RLIMIT_AS,(2147483648,2147483648))` 时返回 `ValueError: current limit exceeds maximum limit`。该位置早于读取metadata、目标file/hash或创建locations.json，因此此case新增目标扫描 **0**、目标执行/模型请求0。

只读补充查询getrlimit的AS/CPU/DATA均为`(9223372036854775807,9223372036854775807)`。这不能证明为什么此Mac拒绝2GiB AS设置；不把错误猜成内存不足或扫描失败。未更改系统limit/安全策略。保留原source/EXPERIMENT，不重跑此case，不把该环境启动错误洗为PASS。

替代是独立 `../v3-locate-02/`：取消mmap整文件/AS硬限请求，改为逐64KiB core+480B上下文读取、总range约114MiB及CPU120秒/墙钟180秒门禁，明确**无可用的OS 2GiB AS硬限证明**；不是相同条件冷重试，新增实际扫描最多1次。此处失败结束，不作为官方二进制或V3配置的失败结论。
