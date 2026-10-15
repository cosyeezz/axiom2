# Axiom 原生仓库认知与代码定位

本目录是一份待实施方案及参考材料。目标是把三层代码索引、仓库概览、约束知识、主动维护、压缩恢复和只读Index浏览器及带定位的批注请求接入 Axiom，并在独立验收通过后退出 AOCI 外部依赖。当前没有生产接入或 AOCI 移除。

从 [00_START_HERE.md](00_START_HERE.md) 开始；唯一实施主方案是 [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)。

运行时沿用现有产品的Node >=22.19.0门槛。本包已有的Node 24参考检查不代表新增能力已通过最低版本验证；阶段0须在Node 22.19.0与24验证所用SQLite和SDK能力。

| 文件 | 用途 |
|---|---|
| `IMPLEMENTATION_PLAN.md` | 现有/目标组件、依赖与扩展边界、真实接线、9阶段出口、110项验收及迁移条件 |
| `contracts.ts` | 目标领域/浏览/批注DTO、窄能力端口及部分私有IPC；不是现有Axiom导出，生产需完整严格schema |
| `schema.sql` | 可执行的初始目标DDL；不代替迁移、图语义、证据和权限校验 |
| `locator.system.md` | 受限定位/维护代理提示词素材 |
| `bootstrap.task.md` | 模块、行为、功能和知识的初始化任务模板 |
| `reference_core.py`、`test_reference.py` | 30项基础参考测试；不包含真实解析器/pi宿主/概览/后台维护 |
| `reference_test_results.txt` | 参考测试输出；不是生产验收结果 |
| `eval_ab.py` | 已有A/B CSV的配对描述性统计；不执行模型、不自动判发布 |

组件梳理见主方案第1.1、2.4–2.7及16.1节：区分已有产品组件、目标逻辑职责和进程，明确唯一状态所有者、宿主组装、窄能力注入及扩展验收。工具查询、变化通知、管理命令和资源关闭分别授权；各语义读取入口共用AuthorizedReadView，正式语义共用CommitCoordinator，pi和SQLite留在适配边界。已接受提案以Worker冻结草稿为唯一提交来源，Runner只返回摘要标识；丢失草稿不补造，已提交事实按持久submission核对。生产IPC及导入依赖检查须在实施中完成，不能把目标类型编译当作架构已落地。

内部pi由Axiom宿主按需启动：前台定位先复用有效索引，不足时才做局部语义核验；后台维护由持久队列在稳定点调度。前台复用现有工具过程展示真实阶段，后台通过目标index.status/index.jobs命令查询。文件变化由程序按内容hash、范围指纹及依赖传播先行失效，模型再判断关系如何修订。

自动上下文由宿主按当前分支、最近已消费用户输入及本轮可信工具访问选择，结合适用约束和有界概览；选择本身不调用模型。当前有效投影提供选择线索，完整当前分支核对输入、编辑和调用/结果配对；省略较新输入不能使焦点回退到旧任务。压缩/重启后只复用可重新核对的对象线索，重新取得当前正文。具体规则见主方案第2.3、6.2、8.3、9.4和10.1节；这些仍是待实施行为。

只读Index浏览器见主方案第8.4节：输入框下方右侧入口，功能树→条件流程→步骤/来源详情，树按关系投影而不复制共享实现。浏览端口list/getObject/readSource独立授权，不启动locator；分页、快照和撤权与其他读取面使用同一事实。[离线交互样稿](../artifacts/prototypes/index-browser/index.html)打开即显示示例功能树和流程；关闭后可通过“打开示例索引”或右下角“Index · 示例”重新打开。样稿全部为合成示例，尚未接入真实产品。

索引批注见主方案第8.5节。样稿点“开启批注”后可批注功能、步骤、分支，或选中详情／源码中的文字；支持编辑、删除、定位原文和“生成修改请求 → 复制修改请求”。请求包含对象／引用实例／分支及版本，源码带hash与UTF-16范围。批注保留在当前页面内存，关闭面板不丢失，刷新清空。样稿不发送消息或修改真实代码；正式产品将复用现有批注与Composer/useSubmission、Steering及失败恢复，主Agent重新核验当前代码后执行。共享实现不承诺仅影响当前流程。

聊天中的Windows文件路径目前不会变成可点击链接。需要从聊天打开样稿时，从仓库根运行 `node artifacts/prototypes/index-browser/preview.cjs`，使用[本机预览地址](http://127.0.0.1:4177/)。该进程仅监听本机并提供明确列出的样稿文件，不连接产品或模型API；前台运行时按Ctrl+C停止。也可直接用浏览器打开HTML文件。

## 当前验证范围

方案中的110项（UI01–UI14覆盖浏览与批注）是未来生产验收清单，不是已经完成的110个测试。Python参考只演示基础内容hash、scope、版本化引用、CAS/事务和统计校验；它不实现新增的module/knowledge语义、概览、上下文交付、队列、导入导出或AOCI迁移。

从仓库根运行参考测试：

```powershell
python -m unittest discover -s axiom-code-index-v1 -p test_reference.py -v
```

Python 3.11+，无需pip依赖；只在临时合成目录写入，不访问真实项目或调用模型。TypeScript目标契约可用当前安装的编译器作独立类型检查；这不等于pi适配编译已通过。另已用锁定pi的内存会话核对编辑、压缩、输入省略和分支的5组底层投影行为，未调用模型或写会话文件；这些检查不构成焦点选择器或产品恢复验收。

样稿批注检查命令为 `node artifacts/prototypes/index-browser/annotations.check.cjs`，需先启动上述本机预览，使用当前安装的Playwright和Chrome。它验证合成目标绑定、源码选区、编辑/列表/定位、限额、复制成功/失败替身和九视口；不写系统剪贴板，不调用产品或模型。目标契约另经严格TypeScript检查；截图保存在样稿目录。

未执行的产品工作包括：当前Axiom接入和真实Index浏览／批注发送、TS/JS真实解析、SDK生命周期与账单/进度验证、分支和任务焦点选择、维护/压缩恢复、跨平台与安装包验收、真实A/B及AOCI退出。

## A/B输入

每条记录聚合本次定位与主Agent读取阶段，列为：

```csv
task_id,scenario,repeat,arm,latency_ms,budget_ms,input_total,output_total,input_cached,success
```

input_total已包含缓存输入，input_cached只是子集；output_total按供应商口径归一，reasoning不重复相加。失败不从样本删除，配对预算相同。初始化和后台维护另入成本台账，按主方案摊销。

scenario分别使用Cold、Warm-new、Warm-rephrase、Exact-repeat、Changed，不合并热语义子组或精确重复。相关变体保留同一task_id，repeat使用预注册的唯一测量槽位，不能靠拆分任务ID增加独立样本数。

```powershell
python axiom-code-index-v1/eval_ab.py actual-runs.csv --out report.json
```

脚本输出按独立task聚类的描述性bootstrap区间，不证明非劣性；近乎全成功时区间可能退化。正式质量门槛在五个判定单元分别把一项任务的全部预注册重复/变体均成功记为任务成功，再按主方案第15.4节计算保守配对下界，五个单元必须全部通过；这与脚本的平均单次成功率是不同终点。阶段0冻结pilot方案、授权总额及调整规则，阶段7完成独立pilot后冻结正式样本量、预算和分析，再开启保留集。正式上线还需单独认知替代验证。AOCI对照不塞入只支持A/B的该脚本。

## 坐标与附件边界

Python参考整行范围为一基闭区间；生产SourceRef固定为零基半开UTF-16，内容hash取原始字节。两者不能直接互传。参考脚本也不实现recordRev、持久证据图、生产投影epoch或导出的RFC 8785/JCS规范化协议。DDL合法不能证明模型summary正确；语义准确性要由当前证据和真实任务评分验证。

本包没有虚构的性能结果。方案目标、已实现内容和实际测试结果必须分别记录。
