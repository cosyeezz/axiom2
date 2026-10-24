# 目的索引：整理、查询与联动覆盖

[返回路线](README.md) · [当前机制](../memory-tree-query.md) · [实施及验收记录](purpose-implementation.md) · [旧查询讨论](02-purpose-query-requirements.md)

## 1. 当前授权与决策

用户已明确授权“入队、整理、查询等缺少部分全部实现”，并最终选择**直接 `memory_query({ question })` 工具模式**，不依赖子代理。此前本文“仅流程讨论”“查询复用委派/通知/结果读取”的状态已被本轮授权及定案替代；[通用执行组件讨论](../agent-execution-component-discussion.md)仍是独立工作，不作为本轮依赖或未完成项。

这里的“兼容”指**改全关联点、遵守主会话和压缩机制**，不是保留四字段、旧Topic ID、旧查询参数或旧快照格式。旧表和原记录保留，不做迁移、清空或双轨读写。仍未授权真实模型调用、正式数据操作、提交、部署或后台重启。

## 2. 已实施流程

```text
纯状态标题树 MEMORY.md
  → 程序识别一级已完成目的（其他一级目的可未完成）
  → 稳定ID + 不可变一级标题定位 + 冻结最多4个同文件相邻目的语境
  → 唯一约束持久入队（目的终态仅一次）
  → 50条或最早入队30分钟，共用互斥槽
  → 分类前逐项校验，失效项隔离
  → 批量语义多叉分类：目的ID、文本、语境、已有目录
  → 完整覆盖/身份/结构/1k目录/输入预算校验
  → 再次验证来源、授权与版本，事务发布树并标记处理成功
  → 分支快照注入一级纯关键字
```

模型只能分类，不能读取来源或正文、分配ID、改写原记忆、产生辅助语境叶子或输出四字段。单项定位失效不毒化其他合法目的；模型/结构/预算失败保留旧索引及本批原ID，60秒后重试。30分钟计时使用首次入队时间，重启持久；新鲜不足50条的余量不立即 drain。

目的身份绑定不可变一级标题，重复根（含大小写和Unicode等价）一律 fail closed；状态、根重排和新增详情不换ID。详情按完整祖先链写独立 Markdown，写入拦截禁止既有节点改名、删除或换父；无旧编号兼容或迁移。语境只取其他一级目的的标题及状态，入队冻结，不附正文，不让未完成辅助目的进入分类叶。

```text
memory_query({question})
  → 发起时捕获最新已发布索引
  → 对当前层完整候选逐层语义导航（可多分支）
  → 程序验证目的映射/授权并定位原目的
  → 由标题路径和真实文件清单产生候选，再选择必要独立详情
  → 完整读取详情及直接显式文本引用
  → 原文归纳 + 所有已读材料修订/链接授权复核
  → 同步工具结果；内部保存处理记录、索引版本及读取轨迹
```

无全库扫描、旧摘要兜底、Topic参数、自由Shell读取或子代理依赖。默认答案不附来源ID/流水，但保留所需目标项目路径。空匹配不是错误；超时、取消、不可用、修订竞争和 `locator_invalid` 保留不同语义。当前始终逐层提供完整候选，未采用未定的3k阈值；引用只展开一跳，不递归。

## 3. 联动实施覆盖

| 链路 | 当前实现及验证位置 |
| --- | --- |
| 目的识别与语境 | `shared/memory-purposes.ts`，严格纯标题树、只取H1完成目的；`memory-tree.test.ts`及`memory-organization.test.ts`覆盖语境≤4、冻结、隔离与重复根身份 |
| 扫描与调度 | `memories.ts`/`memory-scan-worker.ts`，来源扫描独立、applyScan入队，50/30分钟互斥，删除旧整会话门禁/逐文件drain/summary依赖验证；`memory-auto-organize.test.ts` |
| 数据与事务 | `server/memory-tree.ts`新增 `memory_purposes`/`memory_purpose_indexes`，ID唯一、版本CAS、事务发布/撤销；旧表不读写不清理 |
| 分类与查询 | `memory-pipeline.ts`/`memory-prompts.ts`全面替换四字段、Section选择、Topic路由；`memory-query.test.ts`/`memory-summary.test.ts`/`memory-io.integration.test.ts` |
| 纠正与文件边界 | 派生索引先原子撤销，入口/详情尽量只剪受影响目的，其他资料保守撤整源；原文CAS/路径/权限/私有清理记录仍由原文件链控制；organization及session-memory测试 |
| 工具与IPC | `memory-tool.ts`提供question-only schema，`agents.ts`宿主拒绝额外参数；worker及环境预览共用schema；`memory-tool.test.ts`/`tool-summary.test.ts`/`session-environment.test.ts` |
| 分支目录与恢复 | `shared/memory-tree.ts`/`memory-topics.ts`/`memories.ts`，新版payload=2、纯关键字、旧payload拒绝；保留会话初始及选定分支快照语义；`memory-topics.test.ts` |
| 压缩联动 | `memoryCompressionPrompt`排除新旧目录，`compressions.ts`成功后注入最新目录；保留Pi原生完整摘要、快照、修订及安全应用；`compression-memory*.test.ts` |
| API与订阅 | `index.ts`/`transport.ts`/`shared/memory.ts`换新树及空态，删除手工整理scope/状态和命令链，不保留兼容入口 |
| 界面与设置 | `MemoryTreePage.tsx`/CSS任意深度Directory/Purpose、来源跳转、统计与搜索；删除2k软阈值/旧间隔设置；固定50/30min/1k规则文案；`memory-tree.check.ts`/`session-memory.check.ts` |
| 处理记录与工具展示 | 真实分类、directories、details和归纳阶段，preflight零请求失败记录，`tool-summary.ts`显示问题；`processing-records.test.ts` |
| 执行与费用 | 沿用统一PooledMemoryRunner、执行池、供应商停止、关闭、memory_usage与Costs；不创建子执行transcript或父工具二次费用；本地HTTP假API及runner/gate/costs回归 |

## 4. 主会话与压缩约束

- 一级目录名称连同换行≤1000字符；不包含ID、来源、位置或JSON。分类超限拒绝，不静默裁剪。
- **常驻目录**在会话开始记录，并按选定分支恢复；普通请求/reload/首输入编辑不刷新。**查询**每次使用最新发布索引，二者职责分离。
- 新快照version2拒绝旧Topic-ID payload；沿用Pi custom-entry身份不代表兼容旧数据内容，不改写历史分支。
- 只有成功应用压缩才推进最新目录；取消、失败、修订冲突、废弃分支不得泄漏新快照。目录不替代原生完整摘要。
- 进度解析/自动接续仍是原全树语义；目的级索引门禁不改变主任务状态和其他原文读写边界。

## 5. 已知边界与验收说明

- 全历史树及其目的/语境纳入完整分类输入。超预算明确失败保留队列；目前没有无限规模保证或增量分区算法。
- 无根详情的同标题删除再建不能凭文字区分新身份；独立目的应有根详情锚定，不复用不可变标题。
- 引用只读选中详情的一跳显式文本；没有递归引用选择器。关键引用不可读保留失败，不从标题猜答案。
- 假模型证明结构、安全、并发和联动，不证明真实语义分类与召回质量。真实模型评估、长时间负载及正式启用需要另行授权。

实际命令、通过数量、隔离构建及界面结果见[实施及验收记录](purpose-implementation.md)。旧文档保留讨论历史，其四字段、委派承载和“未授权实施”段落不再代表当前机制。
