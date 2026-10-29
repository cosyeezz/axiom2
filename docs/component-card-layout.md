# 连接页与共享组件卡片

本次统一连接页的版本、安装、卸载与依赖展示；执行仍由现有适配器负责，不增加维护权限，不变更后台安装器或 Pi 依赖版本。

## 信息与操作

- 头部顺序：类型图标、名称与路径、该组件的操作、最后的版本。路径保留完整提示、复制与打开能力；当前版本与未检查的候选版本分开。
- 共享递归卡片使用 2px 外框、1px 内框；仅连接页的三张版本概览卡使用较轻的 1px 外框，避免重复视觉强调。
- 普通卡片的说明与环境默认可见。连接页版本卡显式使用 `secondaryLabel`，由原生 `details` 默认收起说明、设置和依赖；内容仍挂载。
- 任务、错误、确认、核实、恢复与必要状态不进入折叠区，动作不放进 `summary`。临时阻塞动作保留焦点和解释，使用 `aria-disabled`，不冒充能力缺失。
- 连接是主操作；运行中的关闭服务为次级描边操作，仍需原确认。进入连接控制页时优先聚焦连接，而不是关闭服务。
- 版本标题提供常显“检查更新”，复用原执行器、忙碌和未核实状态门禁；组件自己的检查入口仍保留。
- 触摸模式中，连接页组件操作、路径动作与说明开关使用至少 44px 的真实且不重叠的命中区域，不靠扩大伪元素实现。

实现：[ComponentCard.tsx](../app/src/client/maintenance/ComponentCard.tsx)、[DesktopUpdates.tsx](../app/src/client/pages/DesktopUpdates.tsx)、[connect-layout.css](../app/src/client/styles/connect-layout.css)、[maintenance.css](../app/src/client/styles/maintenance.css)。

## 安全边界

保留现有任务身份、作用域、取消与延时、恢复证据、token/revision、Windows 平台限制及卸载授权。未知服务状态不沿用旧运行或安装结论；旧确认和在途旧预览跨未知状态失效，恢复后必须重新预览并同意。已接受的维护任务不能因普通错误被解锁或重放。

共享动作解析器不豁免安装、更新、重装、修复或卸载的任务冲突。`BackendMaintenance` 保留原调用接口、资源前缀匹配和 `activeOnly` 语义，仅替换展示；不引入其他工具页或执行器重构。移除旧下载维护中心与启动入口，不移除执行记录或恢复能力。

## 图标与验证

图形与来源见 [component-glyphs.json](../app/src/client/maintenance/component-glyphs.json)，完整许可随 [ComponentGlyph.tsx](../app/src/client/maintenance/ComponentGlyph.tsx) 打包；七图与补充动作的校验目录为 [component-icon-options.json](component-icon-options.json)、[component-action-icon-selections.json](component-action-icon-selections.json)。

[连接控件](../app/tests/connect-controls.check.ts)、[维护门禁](../app/tests/connect-maintenance.check.ts)、[桌面确认](../app/tests/desktop-confirmations.check.ts)使用真实 React 页面和合成 IPC，不操作真实服务或文件。[共享卡片](../app/tests/maintenance-ui.check.ts)与[图标](../app/tests/component-glyphs.check.ts)使用离线内存 fixture。浏览器测试不替代真实 Windows/WebView2、原生安装器或正式打包流水线验收。
