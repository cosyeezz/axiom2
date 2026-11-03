# OpenCLI Google 搜索验收证据

2026-10-31，本机已配置 OpenCLI 2.0.2，用户连接 Chrome，沿用其登录态与网络；没有导出 Cookie、修改代理、启动独立 Chrome 或访问结果落地页。

- [live-results.json](live-results.json)：真实查询脚本→OpenCLI CLI→Chrome。TypeScript：首页7条、nextStart10；第二页10条、nextStart20。随后批量两query各3条。4个唯一session，12条open/eval/close记录均成功，共17.483秒，无验证码。真实CLI `profile list`先固定实际contextId，再执行页面命令；日志不保留该身份值。
- [opencli-comparison.json](opencli-comparison.json)：官方`google search`命令同环境返回TypeScript官网结果；浏览器页实际重定向到Google HK，query/start正确、无验证码。首次本地脚本的`.com`限制导致PAGE_CHANGED，不能归因于OpenCLI失败；精确允许HK后最终live通过。

- [compiled-results.json](compiled-results.json)、[compiled.log](compiled.log)：plain-Node编译产物默认backend真实返回3条候选；无OpenCLI配置时明确失败。
- [tests.log](tests.log)：最终50/50针对性测试通过；另tsc、build退出0。
- [package.log](package.log)：check:package退出0，1088文件，临时隔离安装/服务及升级恢复验证通过；没有生产重启。

## 后续缓存优化验证

- [cache-live-results.json](cache-live-results.json)：真实Chrome同run批量2条+后续1条查询，完整安装校验1次、profile list1次、CLI共10次；新run再查1条后profile list累计2次、安装校验仍1次、CLI共14次。全部open/eval/close成功，总16.621秒；不将该时长解释为相对提速比例。脚本 `/tmp/axiom-search-cache-live.mts` 对真实执行器做计数，没有mock浏览器。
- [cache-compiled-results.json](cache-compiled-results.json)：plain-Node最新编译产物默认backend、无runner注入，2条批量查询各返回2条候选；无配置负例返回OPENCLI_UNAVAILABLE。脚本 `/tmp/axiom-search-cache-compiled.mjs`。
- [cache-tests.log](cache-tests.log)：62/62针对性回归通过；之后只增加一项迟到eval用例，[cache-tests-supplement.log](cache-tests-supplement.log)为缓存测试13/13通过。合计覆盖63个不同用例，源码在首个62项通过后没有再改变。最后tsc通过。
- [cache-build.log](cache-build.log)：构建退出0，仅既有大chunk警告。
- `npm pack --dry-run --json`退出0，清单1092文件；两个新缓存模块、search-query及许可证均存在，7个旧native模块均不存在。原始清单 `/tmp/axiom-search-cache-pack.json` 含prepare/build前缀，解析JSON部分后二次断言通过。本次未重跑完整check:package，上一轮package.log只代表首次替换交付。
- 独立审查发现并修复：已返回命令在run结束后仍可观察、旧contextId被其他profile同名alias冒充、匿名人工tab恢复可能换身份。最终复核未发现新阻断；相关回归均通过。

完整边界见[实现说明](../../web-search-implementation.md)。本文不声称验证了所有Google区域域名或故意触发验证码/profile切换，也不代表生产部署。
