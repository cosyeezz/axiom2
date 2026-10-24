# 执行树状态图标选型

打开 [index.html](index.html) 查看交互选型页面。页面已内嵌全部 SVG，可离线使用；图标来源链接需要联网。

本目录保留设计选型资料；已选的六态图标现已接入 Axiom 会话记忆执行树，正式组件为 `app/src/client/memory/MemoryStateIcon.tsx`。

## 已选方案与动效约束

用户已确认六态图形：[selected-icons.json](selected-icons.json)。页面默认值及“恢复已选方案”均使用以下组合。

| 状态 | 编号／图标 | 动效 |
|---|---|---|
| 未开始 | P02 · lucide:clock | 静态 |
| 进行中 | A22 · tabler:loader-4 | 原有分段图形自身旋转，1.6秒一周 |
| 已完成 | D07 · lucide:check-check | 双勾原有路径描画一次，0.45秒后保持 |
| 等待 | W37 · ph:pause | 暂停符号自身透明度呼吸，2.6秒周期 |
| 失败 | F25 · ph:warning-light | 静态 |
| 已放弃 | X26 · tabler:hand-stop | 静态 |

后续明确要求替代最初选型中的“外围细弧旋转”：所有动效只作用图标自身，不能新增外层圆环、光晕、背景或装饰。完成态继续使用中性灰白。

实现参考 `app/src/client/StatusIcons.tsx` 的 `FoldIcon`、`BubbleLoadingIcon` 及 `DataIcons.tsx`：采用 SVG `animate` / `animateTransform` 时间轴，不依赖外层 CSS 动画。`prefers-reduced-motion: reduce` 不停用这些状态动效，覆盖 Windows 关闭系统动画时的浏览器设置；页面内显式关闭动态预览仍有效。切换标签保留SVG节点，避免完成动画被反复重播。

此版本保留300候选和继续比较的能力，采用新的浏览器保存键，首次打开默认载入用户已选组合；旧版浏览器选择不被删除。

## 范围与使用

| 状态 | 固定编号 | 数量 |
|---|---|---:|
| 未开始 | P01–P50 | 50 |
| 进行中 | A01–A50 | 50 |
| 已完成 | D01–D50 | 50 |
| 等待 | W01–W50 | 50 |
| 失败 | F01–F50 | 50 |
| 已放弃 | X01–X50 | 50 |

每组前五项为优先比较候选。点击卡片将图标应用到左侧16px执行树预览；可以搜索图形名称或图标库，切换候选展示尺寸，单独设置各状态的动效。候选网格保持静态，执行树中展示动态效果。完成态统一使用中性灰白色，不使用绿色。

状态动效提供静态、图形自身呼吸、图形自身旋转、自身描画一次四种选项；填充图形在选择描画时使用自身透明度入场。这些是本地设计预览效果，不表示图标源站本身提供动画；正式执行树使用上表的已选组合。点击“复制选择”或“下载选择”后，将编号和图标名反馈到对话即可。选择在当前浏览器中保存；不同浏览器不共享。

不同库中的近似构型保留为独立候选，便于比较描边、比例、转角和留白；50个候选不等于50种完全不同的语义。搜索其他状态时可以发现同一图标跨状态复用，最终组合应避免混淆。

## 来源和证据

三个并行调研任务分别负责未开始/进行中、完成/等待、失败/放弃。主代理合并后再次核验每态50项、同态ID不重复、每项SVG存在，并生成独立页面。

- [CATALOG.md](CATALOG.md)：按状态整理的300项固定编号与来源链接。
- [candidates.json](candidates.json)：300项固定编号、中文名称、图标ID、来源链接、SVG。
- [sources.json](sources.json)：六个图标集合的作者、授权、集合数据源和核验快照SHA-256。
- 同目录 `*-LICENSE.txt`：Lucide、Tabler、Phosphor、Heroicons、MingCute、Iconoir 的上游许可证。
- [validation.json](validation.json)：首版选型页历史验证，34项通过；其动效实现已被当前图标本体动画替代。
- [validation-intrinsic.json](validation-intrinsic.json)：当前图标本体动效版本33项检查通过；no-preference/reduce各自叠加正常CSS或全局禁用CSS动画共四种环境中，实际旋转矩阵、呼吸透明度及描画路径均随时间变化。验证无新增外围图形、完成不随tab切换重播、300候选可选、持久化和移动排版；未做Windows原生验收。
- [confirmed-intrinsic.png](screenshots/confirmed-intrinsic.png)：当前已选方案截图。
- `screenshots/`：首版六态桌面截图和手机截图，保留作为历史。

图形来自 [Iconify 图标目录](https://icon-sets.iconify.design/) 与其 [公开集合仓库](https://github.com/iconify/icon-sets/tree/master/json)。每张卡片可直达对应图标页面。后续实施时需结合16px实际效果统一视觉重量，并保留相应上游授权。
