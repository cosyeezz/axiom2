# 程序维护卡片图标

用户已确认以下 7 个图形。只替换维护卡片中的对应语义，不改变其他界面的通用图标、安装策略或安全确认。

| 用途 | 选定图标 | 编号 |
| --- | --- | --- |
| 组件标识 | [lucide:blocks](https://icon-sets.iconify.design/lucide/blocks/) | C-25 |
| 环境 / 依赖 | [iconmind:dependency-outline-regular](https://icon-sets.iconify.design/iconmind/dependency-outline-regular/) | E-03 |
| 检查更新 | [mingcute:refresh-2-line](https://icon-sets.iconify.design/mingcute/refresh-2-line/) | Q-47 |
| 安装 / 下载 | [tabler:download](https://icon-sets.iconify.design/tabler/download/) | I-33 |
| 更新 / 升级 | [keyline-icons:package-arrow-up](https://icon-sets.iconify.design/keyline-icons/package-arrow-up/) | U-04 |
| 重新安装 | [mdi:box-refresh-outline](https://icon-sets.iconify.design/mdi/box-refresh-outline/) | R-02 |
| 卸载 / 移除 | [lucide:trash](https://icon-sets.iconify.design/lucide/trash/) | X-24 |

## 实现与视觉尺寸

[ComponentGlyph.tsx](../app/src/client/maintenance/ComponentGlyph.tsx) 使用随包分发的[静态 SVG 数据](../app/src/client/maintenance/component-glyphs.json)，无运行时网络请求或新图标依赖。`ComponentAction` 仅在维护卡局部把旧动作名映射至选定语义；`package` 动作表示安装已下载的包，不能复用组件标识图形。检查安装/自检 `scan`、详情、定位文件等未选择的用途保持原图标。

不是只给 SVG 设相同宽高：

1. 以 2048px 栅格测量原图的实际着色边界，包含描边，排除四周透明留白。
2. 以可见边界中心等比拟合，不拉伸宽高、不改路径。保留抗锯齿边距，避免紧贴裁切边缘截断描边。
3. 在 24 单位公共槽位中，以 22 单位可见长边为基准。密集的组件/升级/重装乘 0.96，圆形检查乘 1.04，较疏的下载乘 1.03，其余乘 1。实际 16px 槽位可见长边约 14.08–15.25px，差异用于补偿视觉重量，不是原图空白造成的大小偏差。
4. 标题、环境行、动作统一为 16px 图形槽位；不再分别套用旧的 19px/13px/16px。MDI 填充图形不继承通用 SVG 的描边，避免无意变粗。

[测量与生成脚本](../artifacts/component-selected-icons/)保留原始 hash、测量结果、光学校正和深浅色 16/24/48px 预览。专用回归为 [component-glyphs.check.ts](../app/tests/component-glyphs.check.ts)，另外保留真实卡片布局与操作回归。

## 许可与分发

[完整许可及修改声明](../app/src/client/maintenance/component-glyphs-LICENSE.txt)保留六套图标库的原始许可正文、作者、来源、原 SVG SHA-256 和修改内容，并作为静态文本打入客户端 JS，在组件标识 SVG 的 `metadata` 中保留；不依赖仓库外链获取许可。

- Lucide 含 ISC 和 Feather 衍生图形的 MIT 声明；`trash` 不能只署名 Lucide。
- IconMind、Tabler、Keyline 为 MIT。
- MingCute 为 Apache-2.0。
- MDI 所选图形的官方名称为 `archive-refresh-outline`，作者 Colton Wiscombe；按官方 Apache-2.0 政策核对其非 Brand / Logos 分类，保留集合例外说明及 Apache 全文。不将集合政策描述为无条件的逐图法律担保。
- MingCute、MDI 及其 SVG 分发仓库的固定上游树均未发现 NOTICE 文件，记录具体版本范围，不推断所有历史版本。

## 行为边界

图标保留原有 `aria-label`、提示、键盘焦点、禁用状态及触屏至少 44px 的操作热区。图形仅作装饰，不替代错误说明或危险确认。此次不增加日志/历史入口，不进行真实组件维护、后台重启或桌面包部署，也不把图标替换当作递归环境管理功能已经实现。
