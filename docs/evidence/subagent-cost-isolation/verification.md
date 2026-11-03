# 子代理打开信息隔离验证

## 修复范围

- `Costs.get(child)` 只返回当前子会话的 scope、任务标题、会话、费用行、合计和警告，包含自己的代理请求、压缩、工具及其他调用；不读取其他会话正文。主会话请求保留家族汇总，owner/version/changed 仍共用家族失效基线。
- 费用弹窗与直链隐藏主 Agent 分类，说明“仅当前子会话”。线程、缓存、上下文、运行耗时与环境入口静态审查均使用 child scope，无需扩大修改。

## 已通过

工作目录 `/Volumes/D_Work/axiom2/app`，所有运行均使用隔离测试数据，未重启真实后台。

1. `./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/costs.test.ts tests/model-usage-statistics.test.ts tests/native-compaction-usage.test.ts tests/kiro-compaction-usage.test.ts`：exit 0，57通过、0失败，见 [unit.log](unit.log)。
2. `AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ./node_modules/.bin/tsx tests/costs.check.ts`：exit 0，见 [browser.log](browser.log)。验证子弹窗/直链/刷新均为 $0.5000、1,700 Token；无主 Agent、兄弟标题/费用；兄弟消费两次更新后子报告完成权威重读仍不变，而主总览依次更新至 $2.1250 + 未知、$2.2250 + 未知。包含五视口、弹层交互、重连、单查询并发与草稿保留。
3. `./node_modules/.bin/tsc -p tsconfig.server.json`：exit 0，[server.log](server.log) 无输出。
4. 所有本次修改文件 `git diff --check` 通过。

已审阅 [子会话独立账单截图](child-only.png)：顶部与累计金额/Token一致，只展示当前子代理。

## 构建限制

- `npm run build`：exit 2，前置类型检查10项错误，均在本次未修改的维护组件调用及 fixture：location/activeOnly 属性不匹配、BackendMaintenanceLauncher/MaintenancePanel/TaskCenterContent 导出缺失、budgets 隐式 any。见 [build.log](build.log)。
- 单独 `./node_modules/.bin/vite build`：exit 1，SettingsHeader 导入 BackendMaintenanceLauncher 但 BackendMaintenance 未导出，见 [vite.log](vite.log)。不在本修复中改动维护组件。
- 未声称完整生产构建或实际部署通过；当前真实后台未重启。生产打包需先恢复上述维护组件接口。
- 默认 Playwright Chromium 未安装，使用已安装系统 Chrome 完成界面验收；未验收原生 WebView、真实供应商账单或生产模式。
