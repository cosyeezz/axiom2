# 任务管理与记忆维护系统提示词

[当前完整定稿：标题路径详情](../memory-title-details-system-prompt.md) · [旧定稿](../memory-task-prompt-concise.md) · [旧定稿来源](../memory-task-prompt-proposal.md)

> 当前契约已改为：主文件仅带状态标题，详情用原生 read/write/edit 写入 `details/<祖先标题>/<当前标题>.md`，程序隐式关联；标题及父级生成后不可改名、删除或移动。不保留旧编号工具或读写协议，不迁移或删除历史数据。下文保留英文翻译阶段的实施与验收历史，不再作为详情机制依据。

当前英文全文及逐字一致性依据仅为[标题路径详情完整提示词](../memory-title-details-system-prompt.md)。最新通用规则保留完整任务树与六态，明确单当前步骤与后台并行、首次要求及决定调整及时维护、后台接续信息压缩前保存、按需恢复而无固定读取顺序；详情就地更新、步骤完成后收敛，长交付安全保存后再摘要引用，不设统一步骤长度；模型不负责书写删除线。下文保留此前英文翻译阶段的实施与验收历史，其旧编号详情、两份文档一致性、通过数与生效说明不代表当前版本。

## 运行时接入

- 实现：[memory-instruction.ts](../../app/src/shared/memory-instruction.ts) 的 `memoryInstruction(path)`。
- 正文逐字采用英文定稿，仅在前面注入实际会话路径：`Session memory file: {memoryPath}`，再以空行连接完整正文。
- [environment-resources.ts](../../app/src/server/environment-resources.ts) 将整段指令加入主会话的追加系统提示词；预览与执行共用该入口。文件链接、委派及测试协作规则也使用英文。
- 子代理策略、任务及记忆工具的模型可见描述与参数说明、内置 `pi-development` 技能的目录简介已翻译。界面标签、运行通知、辅助记忆模型的独立提示词和按需读取的技能正文不属于此次主/子会话系统正文翻译。
- 主文件由多个同级任务树块组成，每块以 `# [status] Goal title` 开始，`## [status] Step title` 及以下组成执行树。具体内容经 `memory_detail` 保存与关联。

## 格式与版本兼容

[memory-outline.ts](../../app/src/shared/memory-outline.ts) 接受 `Not started`、`In progress`、`Completed`、`Failed`、`Waiting`、`Abandoned` 六种英文状态，忽略英文大小写，并规范化为既有内部中文状态。原中文状态、历史状态及复选框格式继续可用；同一文件可混用中英文状态。层级、放弃与等待的继承、接续任务及完成判断保持一致。

详情编号、受管边界、`revision`、`entryRevision`、唯一 `anchor`、局部替换与冲突重读规则保持不变。英文目标可以关联详情并更新状态；无关详情更新不使当前详情版本失效，过期正文覆盖及过期入口关联仍被拒绝。记忆整理器同时识别新的 `Memory correction` 和旧的“记忆纠正”标记。

[axiom-prompt.ts](../../app/src/server/axiom-prompt.ts) 的 Pi 原生分段及差异机制保持原样。新英文 addendum/skills 相对旧中文历史只生成必要的一次更新，保留历史消息；无变化重载不重复更新。用户自定义 `SYSTEM.md`、`APPEND_SYSTEM.md`、`AGENTS.md` 和外部资源按原文加载。

## 验证

在 `app/` 中运行以下三组测试，统一前缀为：

```sh
env -u AXIOM_TEST_COMPILED ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1
```

- `memory-outline.test.ts`、`memory-detail.test.ts`、`memory-tool.test.ts`、`session-memory.test.ts`、`memory-organization.test.ts`：101/101 通过，退出码 0。日志：`/tmp/axiom-english-memory-tests-60c2e9b5.log`。
- `axiom-prompt.test.ts`、`session-environment.test.ts`、`task-titles.test.ts`：14/14 通过，退出码 0。日志：`/tmp/axiom-english-prompt-tests-60c2e9b5.log`。
- `agent.test.ts`、`task-budget-worker.test.ts`、`session-reload.test.ts`：3/3 通过，退出码 0。日志：`/tmp/axiom-english-worker-tests-60c2e9b5.log`。使用本地模拟模型验证真实 Pi worker 的主/子会话消息与重载。
- 仓库根目录执行 `npm --prefix app run build`：退出码 0，仅有大 chunk 提示。日志：`/tmp/axiom-english-prompt-build-60c2e9b5.log`。
- 从 `app/dist` 导入编译后的提示词、会话资源入口及工具定义，确认两份文档与编译产物逐字一致；中文/空格路径和 Windows 路径仅注入一次；模型可见工具说明及参数为英文；混合状态、目标状态更新及两种纠正标记兼容。
- 本轮相关文件的 `git diff --check` 通过。

共 118 项回归通过；验证未调用真实模型，未对正式后台或浏览器界面做专项验收。此前中文版定稿的 60 项回归及 6 项新格式探针记录保留在本会话记忆详情中。

## 生效与既有记忆

源码和构建产物已更新。当前运行的后台需重启后加载新代码，已运行会话需在新后台中全量重载；本轮未重启正式后台。旧的实际环境快照和历史记忆保留原样。

新格式直接以带状态的一级目标标题开头。旧格式若有普通固定总标题，现有校验仍禁止删除或改写该标题；本轮未迁移已有记忆文件。详情工具的后续重设计另行讨论。
