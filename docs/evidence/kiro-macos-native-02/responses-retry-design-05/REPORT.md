# 原生重试设计验证05

## 结果

**5项不同设计 probe 已通过：上一轮4 PASS沿用 + 修正夹具后1项新执行 PASS。** 最终 `npx tsc --noEmit` exit0；`git diff --check` exit0。仅新增离线测试/文档，没有生产实现、package/锁修改、build/restart或真实模型请求。[设计定稿](../../../kiro-native-retry-design.md)不等于原生重试已经接入，生产仍 `1;max=1`。

依据：[合同](CONTRACT.md)；[测试源码](../../../../app/tests/kiro-retry-design.test.ts)。Node22.23.2、Pi1.4.0、已装 Smithy core3.35.2。使用隔离临时目录和自有假凭据/消息；AgentSession 的 streamFunction 是本地合成输出，不调用 OpenAI 或 Kiro，不改变用户的 DeepSeek/off 选择；generic Fetch 被阻止。未做系统级网络审计。

## 实际覆盖

1. **真实安装版 AgentSession 公共事件接点**：首请求503→SDK自动retry→成功工具调用→工具后续请求，主位置 `[1,1,2]`；2次agent_start、3次turn_start，工具仅执行一次；新host run位置1。一次split-turn compaction含history summary + turn-prefix summary，再加一次summary retry，共3次stream，均无main position。没有读取私有turnIndex。
2. **迟到acquisition所有权模型**：caller取消立即reject；旧SDK模拟等待未settle时，后继不能进入；旧等待settle后状态修改完成，取消检查阻止旧send，后继才可发送。
3. **排队取消模型**：被取消排队任务不会执行或绕过未完成predecessor。
4. **实际Smithy构造器**：仅函数provider时budget4→6生效；带options对象（自定义rateLimiter）两次仍返回3，证实动态预算陷阱。
5. **实际Smithy内部等待/成本**：本进程走default分支，Math.random=.5，首次TRANSIENT内部等50ms，capacity500→490，返回token delay0；Qne形状的token不提供有效cost，成功只退1到491。未验证2026分支、完整adaptive桶或第二层Qne等待。

账号owner采用Provider隔离+既有catalog scope代际；access-only轮转可保留，refresh/account/profile变化保守reset。该方案已定稿，**账号隔离尚未有生产控制器可测**。Pi session默认9次retry和native3～6次不能叠乘；设计要求显式retry owner及version-bound bridge协调，启用前必须实现验收。

## 初始失败与修正

- 首次模块加载失败 `ERR_MODULE_NOT_FOUND @sinclair/typebox`，tsc对应TS2307。5个probe均未开始执行。原因是新夹具误用旧包名；改为当前Pi公共导出的Type，不安装依赖/不改生产。[初始测试](initial-test.log)、[初始tsc](initial-tsc.log)。
- 第二轮4 PASS、1 FAIL：主轮/重试/工具断言已通过，summary数量断言实际3、预期2。不是生产缺陷：`compaction.js` 的split-turn分支先history summary再turn-prefix summary，而夹具又配置一次summary retry。改为明确3次并额外核summary含 `Turn Context (split turn)`，保持全部summary不归main的断言，不放宽实现。[该轮结果](fixture-test.log)，该轮tsc exit0（fixture-tsc.log）。
- 仅重跑受影响的公共事件probe，1/1 PASS；4个未变已过probe未重复执行。[最终测试](final-test.log)、[最终tsc](final-tsc.log)。旧252项不计入本轮新验证，也未重跑。

## 命令与退出码

工作目录 `/Volumes/D_Work/axiom2/app`。

```sh
npx tsx --import ./tests/vite-assets.mjs --test tests/kiro-retry-design.test.ts
# initial exit1 (~1s, loader failure); fixture fix exit1 (~1.5s, 4 PASS/1 oracle FAIL)
npx tsx --import ./tests/vite-assets.mjs --test --test-name-pattern='public Pi events' tests/kiro-retry-design.test.ts
# final exit0 (~1.4s, 1 PASS)
npx tsc --noEmit
# initial exit2; import fix exit0; final fixture exit0 (~15.2s)
```

所有命令在合同60/120秒上限内；未在测试覆盖文件仍被运行时修改它们。完整stdout/stderr已保存为同目录日志，无凭据或真实上下文。设计probe中的ProposedTurns/ProposedOwner不被生产导入。

## 来源绑定与局限

公共源码/测试SHA256记录于 [verification.json](verification.json)。仅哈希静态代码，不哈希敏感请求、正文或凭据。

静态调查01～04、live01～06仍关闭，没有扩读官方bundle或重用旧claim。Smithy3.35.2不是已证官方resolved版本；官方2026 flags、并发cache及graph恢复计数边界仍未知。owner串行化/账号reset是安全选择，不是已证官方时序。完整controller/header/classifier/hint/两层等待/adaptive桶/账号隔离/observer及晚HTTP返回仍需后续实现测试和新的受控wire验收。设计完成不代表整体parity或服务端不可区分。
