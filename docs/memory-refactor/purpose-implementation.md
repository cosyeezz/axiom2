# 目的索引与工具查询：实施及验收

[返回路线](README.md) · [当前机制](../memory-tree-query.md) · [全链路覆盖](purpose-flow-coverage.md)

## 状态与授权

目的队列、批量分类、多叉索引、直接工具查询及目录/界面/设置/协议/统计/压缩联动已实现，范围内隔离验收完成。**首次交付时尚未部署或重启；用户随后自行重启，重启后的诊断与修正见下方补记。**

用户明确授权补齐“入队、整理、查询等”，最终选择 `memory_query({ question })`，并追加最多4个同文件其他一级目的语境。测试仅临时数据和假模型（含本地HTTP假API）；没有真实模型调用、正式数据清理、提交、部署或后台重启。现有并行工作区修改保留。

## 实施范围

- `shared/memory-purposes.ts`程序识别纯状态标题树中的一级完成目的；稳定ID、根详情锚定、重复无锚拒绝、入队冻结语境。
- `server/memory-tree.ts`持久队列与索引、50条/30分钟批次、互斥、失败退避、失效项隔离、完整映射校验和事务发布/撤销。
- `memories.ts`/`memory-scan-worker.ts`接通扫描入队和调度，目的级完成门禁替代整会话完成，删除旧summary依赖验证及旧手工整理链。
- `memory-pipeline.ts`/`memory-prompts.ts`只按目的语义分类，查询最新已发布树逐层导航、选择必要详情、完整读原文及一跳显式文本引用、返回前复核修订/授权。
- `memory-tool.ts`/`agents.ts`/`tool-summary.ts`以question-only工具及IPC取代Topic参数；继续走统一执行池和真实用量。
- `shared/memory-tree.ts`/`memory-topics.ts`使用version2关键词快照，拒绝旧Topic-ID payload；保留分支恢复和成功压缩后刷新契约。
- `shared/memory.ts`/`index.ts`/`transport.ts`/`MemoryTreePage.tsx`/CSS和工具栏联动新树、状态、设置及空态。
- 目的fixture及原测试同步新接口，不添加四字段兼容API；保留原文、权限、CAS、分页修订、外证撤销、取消和压缩安全断言。

## 实际验证

所有命令工作目录均为 `/Volumes/D_Work/axiom2/app`。日志和隔离构建位于本机 `/tmp`，不会写共享 `dist`。以下是分别执行的测试集，存在重叠，**不把279与83相加当独立总数**。

### 1. 目的索引与关联测试

```bash
npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/memory*.test.ts tests/session-memory.test.ts \
  tests/processing-records.test.ts tests/compression-memory*.test.ts \
  tests/session-environment.test.ts tests/axiom-prompt.test.ts
```

退出码 **0**，**279/279通过**。日志：`/tmp/axiom-purpose-tests.log`。覆盖严格识别/身份/语境、49/50/30分钟/重启/互斥、失败重试/隔离/事务、最新索引导航/完整读取、原文不写、BOM/CRLF/CAS、跨页修订、外证删除/纠正/撤权、本地HTTP假API仅system+user且无tools、目录分支/旧快照拒绝、处理记录和压缩。

### 2. 独立扩展回归

```bash
npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/session-memory.test.ts tests/compression-memory*.test.ts \
  tests/session-environment.test.ts tests/session-reload.test.ts \
  tests/session-fork-integration.test.ts tests/transport-boundaries.test.ts \
  tests/tool-summary.test.ts tests/memory-runner.test.ts \
  tests/execution-gate.test.ts tests/costs.test.ts
```

退出码 **0**，11个文件、**83/83通过**，0 skipped/cancelled，46.07秒。日志：`/tmp/axiom-purpose-regression.log`。该组在移除最后一个旧worker verify响应分支后运行。

### 3. 类型与隔离构建

```bash
npx tsc --noEmit
npx tsc -p tsconfig.server.json --outDir /tmp/axiom-purpose-build/server
npx vite build --outDir /tmp/axiom-purpose-build/client
```

三项退出码均 **0**。日志分别为 `/tmp/axiom-purpose-types.log`、`/tmp/axiom-purpose-server-build.log`、`/tmp/axiom-purpose-client-build.log`。TypeScript无错误；Vite构建2545个模块成功，仅有大chunk（>500kB）警告，未在本轮引入无关拆包工作。

最终 `git diff --check`清理 `memories.ts`与`memory-tool.ts`各一处行尾空格后，复跑 `npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/session-memory.test.ts tests/memory-tool.test.ts`，退出码0，**58/58通过**；并行 `npx tsc --noEmit`退出码0。日志 `/tmp/axiom-purpose-final-targeted.log`和`/tmp/axiom-purpose-final-types.log`。该组与上面测试重叠，不累加总数。六篇本轮机制/路线文档的相对链接检查通过（历史示例脚注路径除外），范围内tracked diff空白检查通过。

### 4. 界面检查

```bash
AXIOM_TEST_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx tsx --import ./tests/vite-assets.mjs tests/memory-tree.check.ts
AXIOM_TEST_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx tsx --import ./tests/vite-assets.mjs tests/session-memory.check.ts
```

- **语义树退出码0**：来源详情、树浏览、设置持久化、搜索、1440/768/390/320宽度通过。日志 `/tmp/axiom-purpose-tree-ui.log`；截图 `/tmp/axiom-memory-tree-ui/tree-{width}.png`。
- **会话页最终复验退出码0**：完整执行到末尾PASS，编辑/冲突合并、草稿保护、删除来源导航及13视口布局通过；完成态100%、上下文弧线不变及无无限动画通过；空模板/Escape/最终草稿和页面错误数组为空均已执行通过。日志 `/tmp/axiom-purpose-session-ui-recheck.log`。复验后 `npx tsc --noEmit`同样exit0，日志 `/tmp/axiom-purpose-types-recheck.log`为空。
- **失败与修复记录**：会话页首次exit1，旧测试将每个完成图标算作1个animate，而当前双勾图标每项两笔画，2图标实际4个。没有为旧断言改产品图标；改为精确验证2个图标、每项2个笔画动画，并逐个验证stroke-dashoffset、1→0、0.45s、freeze及无repeatCount，随后完整复验通过。
- 新截图位于 `app/test-results/session-memory/tasks-{width}-{height}.png`，复验生成13张非空截图；首次检查1440×900与390×480，主代理复核最终390×480截图，未见越界。树四宽度截图均无横向溢出，主代理另复核320px截图，设置正常换行。旧global截图不算本次证据。

## 重启后补记：来源缺失误计整理错误

用户重启后反馈全局页异常。只读运行诊断确认：页面和处理记录可打开，42个目的尚未达到50条/30分钟触发条件，新索引尚未发布，原始目的队列没有分类错误。页面却显示“整理出错4”，原因是把来源目录的 `reason=missing` / `error=记忆读取失败` 当成批分类失败；这些会话没有可读的 `MEMORY.md`，并未参与分类。旧索引仍在旧表保留，不迁移、不在新页展示。

修正将两类状态分开：

- `MemoryCatalogEntry.organizationError` 仅从当前未隔离目的队列的实际分类失败派生，不读取来源扫描错误或旧生成错误。
- 全局树“整理出错”及详情文案仅依据该字段；缺失源、空模板及尚未分类的目的不会制造整理失败。树发布同步推送来源目录投影，使真实失败和成功重试实时更新，无需重新打开页面。
- 来源自身的 `reason` / `error` 仍保留，不能因隐藏误报而伪造来源可读；真实分类失败遇到来源缺失时仍保留分类错误，成功重试后清除。

修正不清库、不迁移旧数据、不主动调用真实模型，本会话未为该修正构建覆盖正式产物或重启后台。最终验证使用隔离临时数据和假模型：

```bash
npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/memory-summary.test.ts tests/memory-tree.test.ts \
  tests/memory-auto-organize.test.ts tests/memory-io.integration.test.ts \
  tests/memory-organization.test.ts tests/session-memory.test.ts
npx tsc --noEmit
AXIOM_TEST_BROWSER="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx tsx tests/memory-tree.check.ts
```

三项退出码均0；**75/75测试通过**，类型检查无错误。浏览器验证4个缺失源不误报、真实失败实时显示1个来源错误、成功发布后不刷新页面即可清除，并完成原树浏览/来源详情/设置/搜索及4宽度检查。日志为 `/tmp/axiom-memory-error-final-{regression,types,ui}.log`，截图为 `/tmp/axiom-memory-tree-ui/tree-{width}.png`。范围内 `git diff --check` 通过。此前32项测试和需重载页面的首轮UI检查也通过，但最终以上述实时更新复验为准；第二轮委派因外部后台退出取消、未开始有效验证，主代理随后直接完成以上三项检查。

最终只读运行复查：后台在本轮期间经历了外部重启（委派收到“服务正在退出”的取消通知）；本会话未执行重启。当前 `4317` 页面刷新后显示43个待整理目的，`.memory-tree-errors` 数量为0，原4条误报已消失。运行截图 `/tmp/axiom-memory-error-live-fixed.png`。这只验证当前无误报；真实分类失败及成功恢复的实时联动仍以隔离UI测试为证据。

## 明确保留的边界

1. 完整历史分类输入达到配置预算时明确失败并保留队列；尚未实现增量分区或无限规模保证。
2. 无根详情的同标题删除再建不能只凭文本识别新身份；建议独立根详情、不可变目的标题。
3. 查询不递归引用，也不从失效定位猜路径；必要原文不可读会失败，不用旧摘要兜底。
4. 真实语义分类/召回质量、真实模型长时间负载、正式启用和正式数据操作未验证、未执行。
5. 未运行全仓所有非相关测试；以上命令只说明其实际覆盖。隔离构建成功不等于后台已更新。
