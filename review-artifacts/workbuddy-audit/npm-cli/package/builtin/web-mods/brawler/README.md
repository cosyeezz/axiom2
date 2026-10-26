# Brawler

CodeBuddy 自带的系统彩蛋：由 `codebuddy daemon` 启动的服务（Web UI、CodeBuddy Desktop）默认开启，普通 CLI 默认不加载；`CODEBUDDY_BUILTIN_WEB_MODS=1/0` 显式开关，外部设置优先。可在模组中心停用。

自定义趣味交互示例：长按 Web UI 左上角的 CodeBuddy logo（约 0.65 秒，蓄力光环与裂纹走满），像素小人破壁而出。整个页面就是关卡：

- **自由移动**：点击任意元素，小人就跳上去（弹道追踪跳）；←→ 移动，Space 三段跳，L 跳到附近的消息。
- **页面元素都是实体**：消息、你发出的气泡、工具步骤、输入框、按钮都是单向平台。落地会把它压弯，起跳会把它蹬下去，头顶会撞起上方的块，K 冲撞会把它推开，下砸的冲击波让周围一起弹起来。
- **打击感**：J 三段连击（站在元素上也能踩着打），命中时有顿帧、闪白、高频受击颤动、弹簧回弹和整页定向震屏；邻近元素被连带推开。
- **崩坏**：裂纹从真实的击打点放射出来，越打越密，边缘开始缺损，最后碎成带有元素自身配色的像素碎块；大块元素碎裂时有慢动作。
- 8-bit 合成音效（M 静音），连击计分。

所有破坏都只是表现层（行内 transform / filter / clip-path / visibility），不删除 DOM、不触碰业务状态；**R** 一键复原，**Esc** 退出并复原。侧栏收起时可用 `Ctrl+Shift+B` 唤醒。

消息流、输入框与工具步骤通过 CodeBuddy 提供的界面标记（`data-mod-surface`：`assistant-message`、`user-message`、`tool-summary`、`composer`）识别为完整的块。
