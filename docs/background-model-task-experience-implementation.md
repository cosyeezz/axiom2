# 后台模型任务体验：实现与接入说明

[已确认的体验与布局](background-model-task-experience-plan.md) · [模型组件盘点与复用设计](model-components-and-agent-reuse-design.md)

## 1. 交付状态与隔离边界

本文件记录体验方案**后续获授权的独立实现**，不把原盘点中的候选接口、执行器重构或查询子会话方案视为已批准。

- 实现位置：`/Volumes/D_Work/axiom2-worktrees/background-model-task-experience`，分支 `work/background-model-task-experience`。
- 开发基线：`2c513ac20b7d4244627e41e208168c939bffaad4` 加创建 Worktree 时主工作区的 tracked/untracked 快照。主工作区当时已有大量并行修改，**不能把本分支对裸 HEAD 的全部 diff 当成本轮改动**。
- 当前：本次隔离接入已完成；155 项相关自动化测试、两组隔离浏览器检查和最终完整构建通过。旧截断、日志前缀及 Unicode 等价编码诊断的隐私修复已通过独立复核，另有 65 个扩展样本通过。
- 未自动合并、提交或部署；未重启/替换正在使用的后台，未迁移、清空正式数据，未使用真实模型。
- 继续排除 Codemode 等工具内部模型调用。不改变 `delegate` / `cancel_task` / `append` / `read_result` 的契约、权限、预算、生命周期和计费来源；TaskCards / TaskViews 保持原逻辑及样式。

运行中的产品不会因本 Worktree 的构建自动切换到新代码。本文不是线上验收或真实供应商测试证明。

## 2. 用户在各场景会看到什么

| 场景 | 接入后的反馈 | 保持不变的边界 |
| --- | --- | --- |
| 会话标题 | 标题附近增加轻量记录入口；进行中/异常可见，展开看阶段、错误和历史。成功收起展开面板，不在聊天刷消息。 | 手动改名优先；原触发、最多尝试次数、超时与费用路径不变；查看不重新生成。 |
| `memory_query` | 在**原查询工具卡**中补充实际阶段、错误和关联处理详情；区分无匹配目的、无有效依据、结果不完整。 | 仍是 question-only 同步工具，不造查询子会话，不依赖委派、通知或 read_result。 |
| 后台记忆整理 | 全局记忆当前工作空间的树上方显示后续队列、活动批次、来源会话数量、阶段及发布事实；入口关闭时仍有运行/异常提示。 | 复用原目的队列、批次与分类事务；不挂到恰好打开的聊天会话下，不新增重试或停止能力。 |
| 原生压缩 | 在原 CompressionDetail 中展示安全快照、执行资源等待、摘要请求/响应、校验与等待应用；应用确认后才显示完成。 | 保留 Pi 原生 compaction、安全点、分支/修订校验、取消与原账源；摘要生成成功不等于已应用。 |
| 主会话维护与续跑 | 原执行过程标明压缩前维护、任务结果通知续跑、记忆续跑或手动恢复来源；历史折叠过程可保留多个真实来源。 | 不伪造第二份子任务，不从 requestId 或提示词猜来源，不改变续跑权限或计费。 |
| 普通委派任务 | 继续使用原委派锚点卡、任务操作及子会话。 | 不重排或重构 TaskCards / TaskViews；没有新的处理记录副本或第三套任务状态源。 |

没有真实证据时不展示排队位置、预计完成时间、进度百分比或供应商已受理。`callStart` / `callSent` 只说明本地调用代码进入相应阶段，不能证明供应商确认或费用已发生。

## 3. 接入结构

### 3.1 复用现有处理记录

沿用现有 `processing_records` 表及 summary/body JSON，不新建任务表、执行池、业务队列或总后台任务页。

- `ProcessingContext` 增加可选 `runId`、`toolCallId`、`groupId`、`outcome` 和批次范围 `batch`。它们是关联/展示信息，不是新的执行授权或账源。
- `ProcessingRecords.observe()` 合并同一微任务中的变更；`processing:<workspaceId>` 订阅仅推失效修订，**不广播输入输出正文**。
- 已有 `processing.list` / `processing.get` 负责按需读取。列表增加可选 `toolCallId` 过滤，保留原工作空间授权及来源归属检查。
- 标题、记忆 runner/pipeline、压缩控制器在真实业务节点写阶段；结果与错误从原执行路径写入，不增加模型调用。
- `ProcessingSummaryLine` / `ProcessingDisclosure` / `ProcessingRecordDetail` 与原 ProcessingPage 共用正文组件。阶段、业务结果、实际模型、用量及输入输出仍指向同一条记录。

关键代码：

- [processing-records.ts](../app/src/server/processing-records.ts)、[processing.ts](../app/src/shared/processing.ts)
- [客户端共享读取](../app/src/client/processing/records.ts)、[过程详情](../app/src/client/processing/ProcessDetail.tsx)
- [标题入口](../app/src/client/workspaces/TitleFeedback.tsx)、[整理反馈](../app/src/client/memory/OrganizationFeedback.tsx)、[查询反馈](../app/src/client/chat/MemoryQueryFeedback.tsx)

### 3.2 实时读取、重连与撤权

客户端不再每四秒读取列表和详情；改为订阅失效后读取：

1. 以工作空间、操作和规范化筛选条件共享请求。同修订多个入口合并读取；请求未完成时将后续失效合并成串行跟读。
2. 连接 generation 与 scope order 共同校验回执。断线重连先取得新快照，不让旧连接或旧修订的迟到正文覆盖新状态。
3. 撤权清除工作空间内已缓存正文；来源删除或迁移导致的 `NOT_FOUND` / `SCOPE_MISMATCH` 也不保留旧详情。
4. 断线缓存明确标为上次读取/待确认，不当作当前授权或当前执行状态。可选处理订阅失败不拖垮整个聊天连接。
5. 展开详情才读取大正文；隐藏目录页不继续新增处理记录订阅，闲置缓存有界保留。本地耗时计时不发网络请求。
6. 展开、刷新、返回历史均只使用读取命令，不触发模型、重新执行或重新应用产物。

### 3.3 查询工具的关联键

`Agents` 宿主通过既有 memory-call 入口附加 `{ runId, toolCallId }`，不扩展模型可传的 `memory_query` 参数。

`toolCallId` 必须使用现有 `toolKey(runId, rawCallId)`：

- 与原生 transcript / 前端工具调用 ID 共用同一 run 域键；
- 不添加 `tool-` 前缀，该前缀属于 toolResult 消息 ID；
- 不只用供应商 rawCallId，避免不同 run 碰撞；
- 不由客户端凭调用顺序猜关联。

来源回归同时验证了真实 Agents 事件入口、原生消息投影与处理记录筛选的一致性。

### 3.4 队列、事务发布与压缩应用

记忆队列摘要从原目的队列派生，显示 eligible/backoff/blocked 及能确认的时间条件；活动批次中的目的从“后续等待”中排除。批次阈值仍为原有 50 个目的或最早等待 30 分钟，查看不会提前启动。

分类发布采用原 `MemoryTreeStore.publish()` 事务，处理记录的 applied/batch.published/completed 事实经 `recordApplied` 回调在同一事务 COMMIT 前写入。分类或 COMMIT 失败时，树、队列及“已发布”记录一并回滚，避免只成功一半却显示已生效。该回调不是新的发布入口。

压缩阶段保存在原 Compression JSON 的可选 `stage` 字段，沿原控制器、执行池和 IPC 发布。处理记录对历史 `completed` 但 `phase !== done` 的情况显示应用待核实，不冒充已应用；只有原生持久应用事实确认后才标记 applied。

### 3.5 主会话触发来源

`runs.origin` 是 nullable TEXT，沿 Store 原有增列机制添加。仅宿主准入时写以下已知值：

| 值 | 含义 |
| --- | --- |
| `task_notification` | 空闲父会话接到任务结果通知后新开执行 |
| `memory_continuation` | 原记忆维护续跑 |
| `compression_preparation` | 压缩前在主会话中维护记忆 |
| `manual_resume` | 手动恢复主会话执行 |

普通 prompt 和普通子任务不贴上述来源。父会话已有活动 run 时，通知仅 steer 原 run，不新建执行、不改原 origin。

live、冷加载、原始会话及归档视图均依据所属会话的 DB 事实投影；不信任前端/live 消息自带的来源。NULL、空串、未知未来值及历史旧 run 均保持来源未知，不按 requestId 前缀回填，不改写原生会话文件。来源仅为内部溯源信息，不提供恢复权限或额外计费。主会话执行状态旁不再展示“手动继续执行”等内部来源标签，也不另加悬停说明或替代提示；只展示思考、工具调用、完成、失败等实际状态，确需干预时保留原重试入口。此界面收敛不删除 DB、消息及归档中的来源事实。当前通用 resume 入口也承载服务自动恢复，因此 `manual_resume` 不能单独作为用户主动点击的证据。

## 4. 隐私与历史保留

- 处理记录保存与读取均投影公开内容，递归排除 thinking/reasoning/redacted_thinking 块、签名及 provider 私有元数据；支持嵌套数组、assistant 内容及 JSON 字符串内的旧数据。模型配置中的 thinking 等级仍保留，它不是私有推理内容。
- 旧版在过滤前截断的结构化模型正文若已无法安全解析，读取时保守隐藏整段诊断并说明原因。对象、数组、字符串内再次编码的 JSON 及嵌套诊断均适用；日志前缀或 Markdown 围栏包裹的诊断，若仍能识别 thinking/reasoning 块、assistant.thinking、签名或 provider 私有字段，也隐藏整段，不凭正则猜测私有段落的结束位置。检测副本兼容标准 JSON Unicode 转义及多层编码，归一化最多八轮；末轮仍有变化即保守隐藏，因此极深的公开编码也可能不可展示。不会用解码后的检测文本替换公开原文。可解析的公共字段、普通文本与模型配置仍按公开投影显示；隐藏不改变已保存业务产物或重放请求。
- 上述保护限于支持的结构化模型诊断及可识别私有字段片段，不是任意自然语言秘密检测器，也不宣称识别全部供应商自定义键。
- 列表搜索基于公开投影，不因旧 summary 中残留私有字段而命中或透露内容；分页也在过滤后的结果上保持连续。
- 旧记录只做读取时投影，不为了浏览迁移或覆盖旧原文。UI 将原始文本作为文本显示，不执行其中的 HTML/脚本。
- **软删除来源会话后的记录保留是既有策略，不是本轮扩大授权。**同工作空间已授权用户仍可读保留的记忆处理记录；跨工作空间、撤权或来源硬删除后拒绝读取。本轮没有新增产品硬删除入口。
- 同一次调用只使用原 usage / memory_usage / compression 账源；过程卡不是新费用来源，不确定费用不补零。

## 5. 已完成验证与证据

所有测试使用隔离 HOME / AXIOM_PI_DIR / AXIOM_DATA_DIR / TMPDIR、临时 Store 和随机 loopback 端口（port 0），不用正式后台端口。模型交互为离线替身或本机假 provider。

证据根目录：`/tmp/axiom-background-model-tasks-7be0e4da/`。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| processing-records / memory-tree 定向测试 | 20/20，exit 0；其中旧诊断回归含 26 种格式：2 MB 截断、日志/围栏前缀、Unicode 等价键、多层编码及超限隐藏；历史只读 | `targeted-tests-unicode-final/results.log` / `exit-code.txt` |
| 记忆、标题、续跑、压缩交接、归档、启动通知及 run-origin（11 个文件） | 最后 Unicode 隐私修复后 115/115，exit 0；其中来源新增测试 5 项 | `backend-unicode-final/results.log` / `summary.md` |
| 四项委派相关回归 | 20/20，exit 0；对应委派代码未再改变 | `delegation-tests/results.log` / `summary.md` |
| fake-only Playwright 过程反馈 | 修复后 exit 0；浏览器错误与意外连接均为空 | `fake-ui-final/results.log`、`fake-ui-final/artifacts/` |
| 完整 `npm run build` | 最后 Unicode 隐私修复后 exit 0；含 `tsc --noEmit`、Vite、server tsc | `build-unicode-final/results.log` / `exit-code.txt` |
| 原 TaskCards/TaskViews 与四工具边界 | 相对隔离基线无改动 | `delegation-boundary-review.md` |
| 原委派卡片视觉与只读交互 | exit 0；主/子各 6 宽度、折叠历史、任务说明及 legacy 均通过 | `task-layout-final/results.log` / `summary.md` / `artifacts/` |
| 最终只读复核与隐私复验 | 原发现及前缀、Unicode 等价键绕过均已修复；原失败探针转为通过，另有 65/65 扩展样本通过，搜索零泄漏且 DB 字节不变 | `final-review.md`（保留初审及后续处置）、`privacy-followup/review-unicode-final.md` / `logs-unicode-final/` |

浏览器 fake-only 回归覆盖共享请求去重/串行失效、迟到回执、重连新 generation、撤权及来源拒绝、隐藏页订阅、标题顶栏弹层四宽度（320/390/768/1440）和 Esc 焦点返回、原查询卡三类结果、HTML 文本转义、队列/批次区分与压缩未应用状态。Vite HMR 在夹具中关闭并拦截最小客户端 helper，应用 transport 保持真实；不向现用后台连 WebSocket。

未声称跑过全仓测试、真实供应商或正式数据上的迁移；未做系统级外网抓包。构建保留大 chunk 非阻断警告，没有顺带调整打包策略。

### 隔离复跑示例

在 Worktree 的 `app/` 中运行；每次复跑新建 ART 临时目录，不复用已有配置或数据。不要直接省略环境隔离后连接现用后台。

```bash
ART=$(mktemp -d /tmp/axiom-background-model-task-recheck.XXXXXX)
mkdir -p "$ART"/{home,pi,data,tmp,artifacts}

env -i PATH="$PATH" HOME="$ART/home" AXIOM_PI_DIR="$ART/pi" \
  AXIOM_DATA_DIR="$ART/data" TMPDIR="$ART/tmp" \
  ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs \
  --test --test-concurrency=1 tests/run-origin.test.ts

env -i PATH="$PATH" HOME="$ART/home" AXIOM_PI_DIR="$ART/pi" \
  AXIOM_DATA_DIR="$ART/data" TMPDIR="$ART/tmp" npm run build

env -i PATH="$PATH" HOME="$ART/home" AXIOM_PI_DIR="$ART/pi" \
  AXIOM_DATA_DIR="$ART/data" TMPDIR="$ART/tmp" \
  AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  AXIOM_TEST_ARTIFACTS="$ART/artifacts" \
  ./node_modules/.bin/tsx tests/background-feedback.check.ts
```

卡片视觉脚本为 `tests/task-card-layout.check.ts`，在构建后加 `AXIOM_TEST_PRODUCTION=1` 运行，启动的是临时数据、随机端口的独立服务器，不是正式后台。主/子视图分别覆盖 320/360/390/430/820/1440；折叠历史、任务说明焦点与新增消息不抢滚动也有断言。该脚本已对齐开发基线的分段内联历史（不恢复已移除的全局“原始会话”按钮），并确认查看只发历史读取、不执行任务。

## 6. 增量交付与以后接入

证据目录包含：

- `baseline/`、`baseline-manifest.json`：创建 Worktree 时的完整开发基线；
- `incremental-manifest.json`：仅本轮相对基线的文件变更及前后 SHA-256；
- `incremental.patch`：同一基线的文本补丁，不包含其他会话原有改动；
- `incremental-verification.json`：在基线的临时副本执行严格空白检查和补丁应用，再逐文件核对预期 SHA-256 的结果；验证不在主区或开发 Worktree 中应用补丁。

本轮代码分为：

1. server：现有 processing、标题、记忆 runner/pipeline/tree、原生压缩、run 来源及各历史读取投影；
2. shared：可选上下文、结果、队列/活动批次、压缩阶段和 run 来源；
3. client：共用只读反馈/订阅缓存、标题/记忆/查询入口、原压缩与过程来源、小范围样式及标题弹层定位；
4. tests：处理记录隐私/分页/授权与旧截断诊断、事务回滚、run 来源/工具关联、fake-only 浏览器及委派卡片现行历史契约回归；
5. docs：本说明与原方案的状态衔接。

以后合入前应先对照主工作区的新变化做逐文件核对，**不能直接覆盖或整包复制此 Worktree**。`runs.origin` 的增列仅在受控接入启动时按现有机制执行；本轮只在临时数据库验证，未对正式数据执行。原生会话 JSONL 不因新增来源迁移。需要替换/重启正在使用的后台、正式数据变更或部署时，应另行获得明确授权。
