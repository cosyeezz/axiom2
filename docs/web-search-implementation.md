# Google 搜索工具 axiom_search：OpenCLI 查询脚本

## 工具名

模型看到的工具名是 `axiom_search`（原名 `web_search`）。原因：经 kiro.rs 接入 Kiro 时，名为 `web_search` 的工具调用返回的参数总是 `{}`；同一 schema 改名后参数正常（A/B 对照证据见 [evidence/web-search-toolname](evidence/web-search-toolname/README.md)）。改名不影响 schema、返回协议和执行逻辑。界面摘要保留 `web_search` 映射，用于显示旧会话。

## 当前契约

用户明确要求实际调用 OpenCLI，而不只是复用它的解析器；并确认使用已连接 Chrome 的登录态和当前网络。不再启动临时 Chrome、无痕 profile、自建 CDP 或第一内置代理中继。不复制／导出 Cookie，不更改用户浏览器代理。

调用链：

```text
主 Agent axiom_search → 可信 lease RPC → WebSearchService
  → OpenCliSearchBackend 单次查询脚本
  → 已配置 Node + 已校验 OpenCLI CLI entry（无 shell）
  → OpenCLI browser open / eval / close
  → 已连接用户 Chrome 的独立命名标签会话
```

OpenCLI 2.0.2 的官方 `google search` 只有 keyword/limit/lang，无 start 或命名 session。这里实际执行其 browser CLI 命令支持分页、挑战分类和独立页面所有权，**不是导入 Bridge/CDP 自己重写浏览器控制**。默认后台页面，每轮 Agent run 首次通过 `profile list` 将配置 profile／默认选项解析为已连接的实际 contextId，同轮后续查询与命令复用 `--profile <contextId>`，不随默认 profile 切换。未配置默认且连接不唯一时要求用户选择，不擅自挑选身份。配置缺失、禁用、分离或校验失败均明确失败，不回退全局命令或其他浏览器。清除无关 `OPENCLI_CDP_ENDPOINT`，固定使用已连接 Chrome Bridge。

## 文件与边界

- [search-query.ts](../app/src/server/web-access/search-query.ts)：一次查询的 CLI 编排、分页、同页验证观察、清理。
- [opencli-command.ts](../app/src/server/web-access/opencli-command.ts)：配置校验及真正的 subprocess 执行，参数数组、无 shell、输出和时间限制。
- [search-installation.ts](../app/src/server/web-access/search-installation.ts)：实例级成功安装校验缓存、配置与文件身份失效。
- [search-command-cache.ts](../app/src/server/web-access/search-command-cache.ts)：run 级 profile 固定、失败重验及生命周期释放。
- [google-serp.ts](../app/src/server/web-access/google-serp.ts)：固定 DOM 提取表达式，经 `opencli browser eval` 执行。保留 OpenCLI Apache-2.0 来源说明和 [许可证](../app/licenses/OpenCLI.txt)。
- [search-service.ts](../app/src/server/web-access/search-service.ts)、[search-rpc.ts](../app/src/server/web-access/search-rpc.ts)：schema、预算、授权、去重、敏感 URL 处理及 main-only RPC。
- [web-search.ts](../app/src/shared/web-search.ts)：1–4 queries，每条最多1000字符，limit默认10、范围1–50；start范围0–990。

结果仅为 Google SERP 标题、URL、摘要，标记 `evidenceType=search-snippet`、`route=chrome-current`。不打开落地页，不调用 reader 或隐藏模型。下一页只从同 query/origin/language 的实际下一页链接提取，绝不凭结果数量推算。结果总量不是 Agent 最终选用来源的固定名额。

只装配主 Agent，不自动赋予普通子代理或后台模型任务。模型侧说明仅交代何时调用；参数 schema 说明如何调用，不预告结果展示或内部实现：

> Search Google to find relevant web pages.

这次说明精简不改变参数结构、实际返回 JSON 或任何执行校验。

既有 `web_read` 不变；搜索到 reader 的敏感 URL targetRef 尚未实现，敏感地址只提供不可点击展示值与警告。搜索页面执行 Google 自身 JS，但不运行模型提供的 JS；这不是 OS 级网络沙箱。

## 校验缓存

- 首次查询完整校验配置包、入口和 Node；同一搜索服务实例后续复用成功校验。不缓存失败，不持久化凭据或 profile 列表。
- 每个查询（含人工标签恢复）仍读取小型配置并检查文件身份。没有 revision 更新的手动配置修改、禁用、分离、入口／技能／shim／运行时变更也会失效；缺失或校验失败直接拒绝，没有全局 Node／浏览器回退。
- 文件指纹包含 realpath、设备／inode、权限与纳秒时间，覆盖词法和真实祖先链。托管 npm 树仍检查每个路径身份与目录内容时间，发现后代修改或增删；不会用“根目录没变化”冒充完整运行时校验。因保留原有安全检测，托管版不是零文件检查，只是不再反复做整套校验、读取内容和计算 npm 树校验摘要。
- 同一 run 的多 query、分页和后续工具调用复用一次 `profile list` 的 contextId；不同 run 独立解析。配置／安装变化或 CLI 失败后重新核查，但只能精确恢复原 contextId，不接受与旧 ID 同名的其他 profile 别名，不静默切换用户。显式配置 profile 改变返回 `PROFILE_CHANGED`，需新 run 使用新选择。
- `releaseRun` 清除该 run 的缓存并中止活动页面观察，服务关闭清空全部缓存。已返回的命令在 run 结束后也拒绝继续 open/eval，仅允许用原身份清理已拥有的标签。发现 profile 期间 run 结束或安装变化，不发布过期命令。没有可信 ownerKey 的直接调用只在同一个保留人工标签期间维持隐式身份，独立查询之间不共享 profile 缓存。
- 正常同 run 的 N 次查询，CLI 次数从 `4N` 降到 `1 + 3N`（一次 profile list，其余 open/eval/close）；页面尚未就绪或人工验证可能增加 eval。逐页 URL/query/start、验证码与返回结构检查仍在同一次 eval 中，输入／授权／预算／清理检查均保留。
- 连接异常只使缓存失效，不自动重放任何浏览器操作；未知导航的阻塞不会因清缓存解除。清理旧标签使用其原 command/context，不拿新身份猜测关闭。

## 取消、错误与页面所有权

- 每次查询唯一 `axiom-search-*` 会话，仅在 OpenCLI 内管理本次拥有的标签。不会绑定用户当前标签。保留会话绑定可信 workspace/session/run，其他 run 不能恢复；run 结束时人工标签移交用户、不自动关闭，新 run 使用新会话。
- 单 CLI 调用最长30秒、stdout最多512KB；错误诊断不直接回传模型。调用总预算120秒，每run最多20次；服务串行执行。
- 取消先停止当前 CLI 进程，超1秒升级停止该进程；不杀用户 Chrome 或共享 daemon。等待 CLI 退出后，以独立10秒预算请求 `browser close`。
- 清理使用 OpenCLI 默认的 close-window 路径（显式删除 `OPENCLI_CLOSE_OWNED_TAB`）：扩展把本次标签释放为 `about:blank` 并保留容器窗口，下一次查询复用同一窗口，不再每次新建。CLI 未确认 `browser close` 时返回 `CLEANUP_PENDING`，下一次查询先重试清理，不继续新导航。
- 窗口位置（仅 macOS）：Browser Bridge 1.0.26 新建容器窗口时用 `focused:false`，macOS 仍会显示该窗口（上游 jackwener/OpenCLI#2167，修复 PR #2168 未合并）。扩展保护自己的窗口，不允许 `windows.update`，所以每次 `open` 后先用只读 `tabGroups.query`／`tabs.query` 找到唯一的 `OpenCLI Browser` 分组窗口，确认窗口里只有该分组标签或 `about:blank`，再用 `osascript`（`execFile`，窗口 ID 以整数参数传入）最小化。同名分组多于 1 个时先按“干净候选里自有标签最多”选规范分组，把其余分组的自有标签迁移并用 `tabs.group` 并入，用户窗口里的其他标签不动，单步失败被忽略；收敛后仍不是恰好 1 个就放弃窗口操作。孤儿分组来源与上游补丁见 [OpenCLI 容器分组堆积](opencli-container-orphan-groups.md)。首次出现验证码／同意页、或恢复人工验证时还原并激活该窗口；验证完成拿到结果后再次最小化。窗口 ID 每次重新查询，不缓存。窗口操作失败被忽略，不改变搜索结果或错误。剩余限制：窗口首次创建时仍会短暂显示，随后被最小化；其他平台不做窗口处理。
- 验证码／同意页不自动操作；发送人工提示，后续观察请求 foreground 模式，最多等待90秒。同页验证中取消或超时保留标签；相同 query/start/limit 重试只观察、不重新导航，其他查询返回 `VERIFICATION_PENDING`。服务退出也不会强关已交给用户的验证页面；必要时用户手动关闭。
- 空结果需明确 Google 无结果文案；未知 DOM、查询/offset不符、CLI失败、无效JSON均单独报错，不伪装为空结果。
- CLI 强杀不能撤销已经送到共享 daemon 的操作。导航调用失败／中断返回 `OPENCLI_OUTCOME_UNKNOWN` 并保留未知状态；即便随后 close 成功，也无法排除迟到导航。新请求因此被 `CLEANUP_PENDING` 阻塞，需人工检查残留标签后重新启动搜索服务；不把清理回执冒充已证明取消。
- Google 搜索页允许精确的 google.com／www.google.com 和 google.com.hk／www.google.com.hk，后者是当前用户 Chrome 的实际区域跳转；其他区域域名暂未验证，会明确失败而不是接受任意相似域名。

## 验证状态

真实 OpenCLI 已成功验证，无验证码：`TypeScript` 首页7条、nextStart10；第二页10条、nextStart20；批量 `TypeScript official documentation` 和 `OpenCLI GitHub browser automation` 各3条。4个唯一会话的 open/eval/close 均成功，总17.483秒。证据已保存至 [验收目录](evidence/web-search-opencli/README.md)；原脚本 `/tmp/axiom-opencli-search-live.mts`。仅浏览 SERP，没有访问候选正文。

此前同环境官方 `opencli google search` 对照也成功；最初脚本误拒绝 google.com.hk，修复精确区域域名后通过。首次 OpenCLI 替换交付时，50/50针对性测试、tsc、build、`check:package`全部通过。包共1088文件，包含新CLI脚本及许可，旧7个native模块在dist/包中均已删除。plain-Node编译产物未配置OpenCLI时明确失败；编译产物默认backend真实调用OpenCLI又返回3条候选，确认不是仅fixture注入通过。测试日志见验收目录；构建日志 `/tmp/axiom-opencli-search-build-final.log`。这是针对性验证，不宣称全仓库测试通过。

旧独立匿名 Chrome 方案已退役，其24项测试、包检查及 CAPTCHA smoke 不作为本方案通过证据。旧方案从未成功返回真实 SERP，不能据此断言 OpenCLI 也需要验证码。真实验证码、profile切换和扩展故障没有故意触发，仅通过fixture／静态检查覆盖。

### 缓存优化实测

真实 Chrome 同 run 的两条批量查询加一次后续查询：完整安装校验 **1次**、`profile list` **1次**、CLI合计 **10次**（原流程为12次）。换新 run 后重新解析 profile，安装校验仍复用；4条查询合计14个CLI调用，全部 open/eval/close 成功。完整证据：[cache-live-results.json](evidence/web-search-opencli/cache-live-results.json)。这证明调用次数减少，不把网络波动下的总时长当成提速比例。

plain-Node 最新编译产物的默认 backend（未注入 runner）也真实完成2条批量查询，各返回2条候选；无配置时返回 `OPENCLI_UNAVAILABLE`：[cache-compiled-results.json](evidence/web-search-opencli/cache-compiled-results.json)。未故意触发真实验证码、断线或用户 profile 切换，相关边界用fixture验证。

缓存优化回归62/62通过，之后仅增加迟到eval用例，缓存文件补测13/13通过（合计63个不同用例）；最后tsc、构建和pack dry-run均成功。清单1092文件含两个缓存模块，没有旧native模块。本次未重跑完整check:package。详见[验证记录](evidence/web-search-opencli/README.md#后续缓存优化验证)。

尚未生产部署或重启。包检查可能使用临时隔离安装和测试服务，不等于生产部署。
