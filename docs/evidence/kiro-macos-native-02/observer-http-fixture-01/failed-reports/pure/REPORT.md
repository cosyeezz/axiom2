# 独立 pure + 审计：失败（保留原始退出码）

仅自有 fake Node HTTP API 观察组件；不是官方/M3/parity。仓库无写入。

- 源码前后 SHA256 均为 `dbe252b5219077352a1a36f45f1939178f53e812fdc6b125d715776437a026ad`。
- 实际运行 `v22.23.2 / darwin / arm64`。
- 临时根目录 `/private/tmp/axiom-pure-audit.kHr4ztJX`，各 child 使用独立 cwd/HOME/TMPDIR。env 仅 HOME、TMPDIR、PATH、LANG、LC_ALL；未设置自动 guard。pure require 拦截检查没有 fs/http/https/net/tls/child_process 导入。
- 完整测试源码 [suite.cjs](suite.cjs)，完整监管器 [runner.py](runner.py)，逐 child argv/cwd/env/退出码与 SHA [results.json](results.json)，完整输出 [runner.log](runner.log)。

执行命令（外层 shell 原样保留 runner exit=1）：

```sh
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/private/tmp/axiom-pure-audit.kHr4ztJX/home TMPDIR=/private/tmp/axiom-pure-audit.kHr4ztJX/tmp /usr/bin/python3 /private/tmp/axiom-pure-audit.kHr4ztJX/runner.py > /private/tmp/axiom-pure-audit.kHr4ztJX/runner.log 2>&1
```

core 7/7 exit0；chunks 3/3 exit0；caps 4/4 exit0；audit 2/3 exit1。总计 16 pass / 1 fail；runner exit1。没有修改 oracle 或重跑取绿。

已覆盖原 this/参数对象 identity/实际参数个数/一次调用/return object 与 boolean/throw object identity/callback identity；输入 getter 不重读；alias、函数 length/name、继承与自有 descriptors、重复安装和失败回滚；sink throw；sticky 首故障；event/log/body cap；Buffer、偏移 Uint8Array、utf8/latin1/empty/非法 chunk；header getter 异常保持原 API 返回/抛出/回调。

**真实缺陷**：write wrapper 先 sample、再调用 original、最后累计 bodyBytes；original 可重入 write，两次各4字节都通过 cap=4 的检查，最终 `bodyBytes=8, ok=true, reason=null`，两条 body 日志均已输出。位置：fake-http-tap.cjs:54,57,93–105。失败原值及堆栈见 audit.stdout.log。建议采用重入安全预留并对原调用抛错回滚，或累计前复核并 fail closed；修复需由主 agent 协调，当前没有改源码。sink request-event 重入的单独案例正确报 body-cap。header metadata getter 抛异常案例仍保持原返回与 callback。

资源：elapsed 0.1281s，children CPU 0.115617s，child 合计输出3178B，最大1920B，无超时/中断。监管每 child10s、总60s、child CPU硬限30s并检查累计CPU30s、输出每 child1MiB/总4MiB。

未验证：真实 HTTP/HTTPS、wire/receipt/TLS/官方运行/M3/parity、OS sandbox、全部异常 accessor/Proxy/异步重入及深度压力；未安装、联网、调用模型或扫描进程。未证明进程树 containment；仅四个直系测试 child。
