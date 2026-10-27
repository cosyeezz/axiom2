# 配置加载：低风险优化与多轮复核

本批承接[配置与会话加载调研](settings-session-loading-audit.md)，只减少配置页重复计算，不改变交互或数据协议。基于实施开始时的当前工作区精确编辑，保留仓库其他已有修改。

## 已实施

- [useConfiguration.tsx](../app/src/client/models/useConfiguration.tsx)：按不可变引用缓存当前供应商、规范化草稿/已保存快照、编辑器基线和筛选结果。保留 `clearKey/keepUrl/keep=false` 与省略等价的 dirty 规则；不是以对象身份代替内容判断。
- [ModelRegistry.tsx](../app/src/client/models/ModelRegistry.tsx) 与新 [ModelRows.tsx](../app/src/client/models/ModelRows.tsx)：抽出 `memo` 子表，稳定操作回调并保留完整依赖。连接字段、搜索供应商、复制提示及连续编辑不再无关地重建所有行。保留原 `tbody/tr`、key、CSS、ARIA 和删除按钮实例，不卸载已访问面板，不冻结隐藏内容或忽略 callback 比较。
- [model-service.ts](../app/src/server/model-service.ts)：同一个模型行只调用一次 `runtime.getModel(providerId, configId)`，复用名称、输入能力、思考等级和计费元数据；只在本次行映射内复用，不跨请求缓存。价格仍逐行新建对象、输入数组仍复制，fallback 优先级不变。

ModelRegistry 仍由 Models 页面动态导入，ModelRows 属于该延迟加载子图，没有加入启动入口的静态依赖闭包。

## 可复现收益与行为验证

新增 [settings-computation.check.ts](../app/tests/settings-computation.check.ts) 使用当前源码 Vite、模拟 WS、两家供应商各 200 个模型。仅在测试页面注入 `JSON.stringify` 与模型数组 `filter/map` 计数，不在产品中加入性能插桩。

| 操作 | 完整供应商草稿序列化 | 模型数组过滤 | 模型数组 map |
| --- | ---: | ---: | ---: |
| 搜索/清空供应商 | 0 | 0 | 0 |
| 模型标签隐藏时修改连接字段 | 1（只计算变更草稿，不重算已保存基线） | 0 | 0 |
| 编辑器进入 dirty 后继续输入 | 0 | 0 | 0 |

这些断言针对具体动作的重复计算，不代表编辑器自身完全不计算，也不是用户端耗时下降百分比。原实现的快照和过滤在每次 hook render 执行，模型行在每次 Registry render 执行；本批验证它们确实在无关更新中被复用，而非只加了无效的 memo。

同一浏览器回归还验证：
- 首访模型表不挂载；首访后隐藏标签保留原行 DOM。
- 临时密钥清空、URL 还原后恢复 clean；编辑输入保留焦点。
- dirty 编辑器的放弃确认仍有效，取消不丢草稿；隐藏编辑器参与统一保存。
- 切供应商暂存最新编辑；复制两次使用最新列表生成不同名称。
- 真实鼠标单击延迟确认可取消，键盘确认与双击删除仍可用。
- 模型搜索及清空、两次完整保存保留未访问供应商的 200 个模型；没有自动 catalog 请求或 pageerror。

新增 [model-read-reuse.test.ts](../app/tests/model-read-reuse.test.ts) 包装本次 runtime 的 `getModel`，证明每个配置 ID 恰好一次查找，并覆盖：跨供应商同 ID、复制模型配置 ID、运行时缺失的 fallback、显式零价格、tiers、input/价格对象隔离，以及配置修改后再次读取得到新元数据。调用次数断言不依赖 SDK 遍历顺序。

## 检查记录

工作目录为 `app`；浏览器使用本机 Chrome，所有数据为临时夹具或模拟传输，未访问真实用户数据、未调用外部模型、未重启真实后台。

- `settings-computation.check.ts`：通过；[日志](/tmp/axiom-safe-loading-computation.log)。
- 现有 `settings-loading.check.ts`：通过；390×844、200 模型、跨标签草稿、字体目录按需/复用/失败恢复/迟到保护；[日志](/tmp/axiom-safe-loading-settings.log)。
- 模型相关 11 个单测文件：43 个原有用例通过；新增复用用例初次因测试假定遍历顺序失败，消除无关顺序假定后单独通过。产品代码在这些检查期间未变化；[原批量日志](/tmp/axiom-safe-loading-server-tests.log)、[新增用例复验](/tmp/axiom-safe-loading-read-reuse.log)。
- `tsc --noEmit`：修正新增测试的两个类型错误后曾全量通过；第一批交付前复查时，工作区被并行加入本批未修改的 [kiro-worker-warming.ts](../app/tests/fixtures/kiro-worker-warming.ts)，其 `this` 类型与 `cacheVersion` 字段产生两处类型错误，当时全量检查为 exit 2，不能称该次仓库类型全绿；[最终全量日志](/tmp/axiom-safe-loading-types.log)。使用[临时配置](/tmp/axiom-safe-loading-tsconfig.json)仅排除这一个新夹具，其他源码/测试保持相同检查范围，exit 0；[范围检查日志](/tmp/axiom-safe-loading-types-scoped.log)。没有修改该无关文件以消除错误。
- `vite build --outDir /tmp/axiom-safe-loading-build`：通过；未覆盖仓库 `dist`，仍有大 chunk 的非阻断警告；[日志](/tmp/axiom-safe-loading-build.log)。本批产品代码在验收期间未变；检测到其他并行源码变化后，再构建到 `/tmp/axiom-safe-loading-build-final` 也通过；[最终日志](/tmp/axiom-safe-loading-build-final.log)。
- `model-save.check.ts` 的当前源码隔离副本（`dev:true`）：通过；真实临时配置的密钥写入/替换/空值保留、失败保护、进度/inert、移动布局、注销确认/取消/重复提交、模型保留及不确定状态协调均覆盖；[通过日志](/tmp/axiom-safe-loading-model-save-ready.log)。检测到并行修改服务端入口后，补跑同一隔离副本仍通过；[最终日志](/tmp/axiom-safe-loading-model-save-final.log)。
- `model-copy.check.ts` 的当前源码隔离副本：通过；剪贴板、重复/嵌套复制、落盘/重载/私有 header、复制模型编辑、5 种桌面宽度及 390px 触屏均覆盖，最终无 pageerror；[通过日志](/tmp/axiom-safe-loading-model-copy-current.log)、[截图](/tmp/axiom-safe-loading-ui/model-copy-artifacts)。

两个 UI 原检查并非原样通过：[copy 首次日志](/tmp/axiom-safe-loading-model-copy.log)、[save 首次日志](/tmp/axiom-safe-loading-model-save.log)均保留。只在 `/tmp` 副本修正测试前提，没有修改产品或原测试：
1. 复制页重载后等待懒表实际显示 4 行，再断言行数。
2. 重新读取配置等待“已读取已发布配置”完成反馈，而不是请求刚开始就满足的 `data-error=false`。
3. 原复制检查试图点击未改动编辑器的“完成编辑”，与现有 `disabled={!editorDirty}` 语义不符；副本先断言未改动时禁用，再只改名称、保持相同上游 ID，验证能完成编辑。原禁用语义未改，不能把此适配描述为产品修复。

复跑命令示例：

```sh
cd /Volumes/D_Work/axiom2/app
AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs tests/settings-computation.check.ts
./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/model-{read-reuse,metadata,credentials,catalog,pricing,input,overrides,copy,runtime,config-validation,display}.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vite build --outDir /tmp/axiom-safe-review-final-build
```

## 后续多轮复核

停止条件：只在本批低风险范围内寻找具体、保行为的重复计算目标；发现目标就实施并验证，重新计数，连续两轮无可实施目标才停止。不为凑轮数扩入滚动、保存协议、认证或导航。

### 第 1 轮：发现并实施目标

- [useConfiguration.tsx](../app/src/client/models/useConfiguration.tsx)：初读/重读后 `providers` 和 `savedProviders` 共用同一数组，直接复用已保存基线的规范化字符串，避免对同一数据序列化两次。真正变更的草稿仍单独序列化，并继续按原内容规则比较 dirty。
- [Models.tsx](../app/src/client/pages/Models.tsx)：按 `[providers, query]` 缓存供应商筛选，在循环外计算搜索词小写。该文件包含其他并行修改，本轮仅调整此表达式和 `useMemo` 导入。
- [model-service.ts](../app/src/server/model-service.ts)：[nativeProviderTemplates](../app/src/server/model-runtime.ts#L24) 自身已逐次复制模板和 `methods` 数组，删除服务层紧接着的第二次复制。补测消费者修改返回模板后，下一次读取仍不受污染。

新增计数断言的实现前基线通过：[日志](/tmp/axiom-safe-review-round1-baseline.log)。两家供应商各 200 模型时，初读完整快照从 2 次降为 1 次，编辑器继续输入时供应商筛选从 1 次降为 0 次；[实现后日志](/tmp/axiom-safe-review-round1-computation.log)。这些是计算次数，不是端到端耗时百分比。

本轮验收：
- 新计算断言及原有草稿、焦点、复制、删除、隐藏表和两次保存回归通过；现有移动端加载检查通过：[加载日志](/tmp/axiom-safe-review-round1-settings.log)。
- 11 文件模型单测完整命令本轮 **44/44 通过，失败/跳过均 0**，含新增模板对象/方法数组跨读取隔离：[日志](/tmp/axiom-safe-review-round1-server.log)。与上文第一批的测试适配历史分开记录。首次误从仓库根启动因路径缺失未执行测试，随后从指定 `app` 目录完整运行成功。
- 全量 `tsc --noEmit` exit 0：[日志](/tmp/axiom-safe-review-round1-types-final.log)。隔离生产构建 exit 0，2594 modules，原大 chunk 非阻断警告仍在：[日志](/tmp/axiom-safe-review-round1-build.log)，输出仅在 `/tmp/axiom-safe-review-round1-build`。

本轮有可实施目标，因此连续无目标次数仍为 0。

第一轮实施前已重跑全量类型检查并通过：[日志](/tmp/axiom-safe-review-round1-types.log)。上文第一批结束时的两处外部夹具错误已因该文件的并行更新消除，没有修改该夹具，也没有继续沿用旧失败结论。

### 第 2 轮：规范化判断短路

[draftSnapshot](../app/src/client/models/useConfiguration.tsx#L12) 改为先判断 `item === false`，只有该值为 false 时才检查是否为 `clearKey/keepUrl/keep`。仅交换两个纯判断的顺序，不改变省略规则、其他 false 值或 dirty 的内容比较。

- 新增测试侧 `Array.prototype.includes` 计数，仅识别该三标志数组。同一初读夹具没有 false 值，标志名判断从 **4431 次降为 0 次**；含 false 的实际草稿仍按需判断，不承诺所有配置恒为 0。[实现前日志](/tmp/axiom-safe-review-round2-baseline.log)、[实现后日志](/tmp/axiom-safe-review-round2-computation.log)。
- 从实施前备份与当前 hook 的 AST 提取实际 `draftSnapshot` 做 **45 类输入差分**，覆盖三标志、非标志 false、嵌套 header/body、true/null/空串/零/undefined 等；输出完全一致，输入无变更：[差分脚本](/tmp/axiom-safe-review-normalizer-equivalence.mjs)、[日志](/tmp/axiom-safe-review-normalizer-equivalence.log)。
- 另以合成 8×250 模型做独立微基准，单次标志名判断 40057→2008，仅用于判断这个局部短路确有减少工作，不作为用户端 E2E 耗时提升依据：[日志](/tmp/axiom-safe-review-normalizer-false-first.log)。
- 计算回归和[移动端加载回归](/tmp/axiom-safe-review-round2-settings.log)均通过，首轮 snapshot=1、编辑器供应商筛选=0 继续成立；false 还原 clean、焦点、隐藏编辑器保存、复制删除等原有断言保持通过。
- 全量[类型检查](/tmp/axiom-safe-review-round2-types.log)与[隔离构建](/tmp/axiom-safe-review-round2-build.log)均 exit 0，2594 modules；产物仅在 `/tmp/axiom-safe-review-round2-build`，大 chunk 非阻断警告仍在。服务端产品及测试未再改动，不重复跑已通过的 44 项。

本轮仍有可实施目标，连续无目标次数重新从 0 开始。

### 第 3 轮：空搜索与无消费者读取

- [useConfiguration.tsx](../app/src/client/models/useConfiguration.tsx) 的模型筛选和 [Models.tsx](../app/src/client/pages/Models.tsx) 的供应商筛选，对真正空字符串直接复用只读源数组。不对查询做 `trim()`；非空搜索逻辑不变。现有消费者只遍历/读取长度，不能原地修改返回数组。
- [model-runtime.ts](../app/src/server/model-runtime.ts#L115) 的 metadata-only 分支：没有动态目录消费者，或已有显式 `modelsStore` 时，跳过无用 `models-store.json` 读取和解析；有动态消费者时仍在首次凭据 await 之前取一次文件快照，不跨 runtime/请求缓存。首个消费者执行期间磁盘变化不改变其他消费者的快照。
- 复核时还保守保持默认超时顺序：文件缓存准备完成后才创建默认 5 秒预算，全部动态消费者共用同一个 signal；外部 signal 原样传递，显式 store 异步读取仍在预算内。不为没有动态消费者的 runtime 创建无用计时器。publish 的取消检查、普通 provider 失败隔离和只读策略不变。

新增基线均先通过再修改实现：[浏览器基线](/tmp/axiom-safe-review-round3-baseline.log)、[元数据基线](/tmp/axiom-safe-review-round3-metadata-baseline.log)。实现后结果：

| 场景 | 实现前 | 实现后 |
| --- | ---: | ---: |
| 初读模型数组过滤 | 1 | 0 |
| 初读供应商数组过滤 | 1 | 0 |
| 清空模型搜索后的模型过滤 | 1 | 0 |
| 无目录消费者的空配置/静态供应商：目录缓存文件读取 | 各 1 | 各 0 |
| 显式 modelsStore：额外目录缓存文件读取 | 1 | 0 |
| 两个动态消费者：目录缓存文件读取 | 1 | 仍为 1，共享同一快照 |

[计算回归](/tmp/axiom-safe-review-round3-computation.log)和[移动端加载回归](/tmp/axiom-safe-review-round3-settings.log)通过，含双空格查询、空结果不丢供应商选择、清空恢复，以及之前的全部草稿/焦点/复制删除/两次保存断言。这里减少的是筛选，不是模型表虚拟化；打开模型标签仍会渲染完整行。

[model-metadata.test.ts](../app/tests/model-metadata.test.ts) 补精确文件计数、显式 store 优先级、共享快照，并补文件→默认 timeout 事件序、provider/credential/store 同一 signal、外部 signal 不创建 fallback、取消时禁止 publish update 且 AbortError 外抛、普通错误仍隔离。定向 **6/6** 和全量类型检查已通过：[定向日志](/tmp/axiom-safe-review-round3-final-metadata.log)、[类型日志](/tmp/axiom-safe-review-round3-final-types.log)。第一次 45/45 模型全套通过后，因超时顺序补强，再冻结最终版本完整复验：

- **11 文件、45/45 模型测试通过**，失败/跳过/取消均 0；上述新增 signal/取消断言均实际执行：[最终模型日志](/tmp/axiom-safe-review-round3-final-server.log)。仅 Node SQLite ExperimentalWarning，不阻断。
- **最终隔离生产构建通过**，2594 modules：[最终构建日志](/tmp/axiom-safe-review-final-build.log)，产物仅在 `/tmp/axiom-safe-review-final-build`；仍有大 chunk 非阻断警告。
- 超时补强后只改服务端和对应测试，客户端源码未变，不重复第三轮已经通过的两项浏览器检查；其通过记录不能表述为真实后端超时/取消的浏览器 E2E。

本轮有目标，连续无目标次数仍为 0。

### 第 4、5 轮：连续无新增目标，停止

两轮各由独立的客户端与服务端只读复核构成，主执行者核对证据及差异。第 4 轮检查剩余计算、列表别名和消费者、闭包依赖、目录快照与超时语义；第 5 轮对照实施前备份，进一步反证 dirty 规范化、隐藏编辑器生命周期、模型 ID/输出对象所有权、换盘/取消/异常分支。两轮均未发现本批范围内有实质收益、可低风险实施的新增优化或必要修复。

未为了凑目标增加全局 dirty 增量缓存、SDK getter 跨行复用、自定义 memo 比较器或虚拟化：前两者缺乏足够一致性/纯度保证，后两者增加交互与更新风险；少量标题查找、字符串拼接和 JSX 重建也没有足够收益证据。没有把测试未覆盖的所有边界都当成已证实缺陷：同 ID 模板覆盖顺序仍主要是静态核实，取消也不能强制中断忽略 signal 的 provider。

最终产品与对应三份测试共 9 个受控文件的 SHA-256 全部与冻结清单一致：[清单](/tmp/axiom-safe-review-final-frozen.sha256)。没有在验收中修改这些文件，也没有把其他并行工作算入本批。最终模型测试、类型检查和隔离构建通过；第 3 轮客户端通过记录适用于同一客户端版本。

**至此共完成 5 轮：前 3 轮发现并实施目标，第 4、5 轮连续无目标，满足停止条件，停止追加优化。实现仅在源码与 `/tmp` 验证产物中，未部署、未重启真实后台。**

## 没有改动和不能宣称的部分

- 没有改聊天滚动、阅读锚点、会话鼠标选择的 300ms 单/双击策略、跨页导航、保存协议或认证流程。模型删除按钮的 500ms 确认策略也保持不变。
- 没有拆分全量 `configuration.get`，没有减少首访响应体；模型标签首次打开仍挂载当前供应商的全量行，没有引入虚拟化。
- 没有处理会话目录冷计数、历史完整投影、环境/费用首屏详情请求等后续协议工作。
- 调研发现的 `delivery-navigation.check.ts` 同任务连续两次导航基线失败仍然存在，不属于本批；本批不宣称修复闪屏、全部滚动问题或真实用户会话切换耗时。
- 当前收益证据是隔离夹具中的计算次数与功能断言，不是实际用户设备、目标 WebView、原生 IME 或弱网络的端到端性能保证。
- memo 正确性依赖已有不可变更新约定；未来不得原地修改 providers/models/editor。删除计时器/确认框在异步重载期间可能保留触发时回调，是既有边界，本批不扩大修改范围。
