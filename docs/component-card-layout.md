# 组件维护卡片布局

递归卡片展示与现有安装器／任务适配器已接入；这不是[通用生命周期契约](nested-component-card-design.md)中完整数据源和安装器注册控制器的实现。本轮仅调整布局源码、离线测试、文档及隔离开发预览，未部署或重启正式应用，也未执行真实维护。

## 头部与正文

- 头部顺序是 **类型图标、名称及下方路径 → 操作 → 最后的版本**。名称在上、已知安装／程序位置在下，左边缘对齐，两行盒之间仅留 2px，不增加大块留白。路径保留完整值提示以及接入方原有的复制／打开能力；不虚构缺失路径。
- 操作紧跟名称／路径组合，不被中间留白推到卡片最右；版本排在操作之后并对齐头部右边缘。当前安装事实与最新／推荐候选来源分开；尚未检查候选不能用当前版本代替，未知安装状态不等于未安装。
- 宽窄卡均保留名称在上、路径在下的紧凑两行：名称与路径可省略，完整名称由 `title` 保全，完整路径由提示保全。本卡内容宽度不超过 360px 时，版本移到头部最后一行；展开折叠操作时，动作占第二行、版本在第三行，任何宽度下版本都在最后。长版本允许自然增高，不强求任意长串单行。
- 不再提供问号详情按钮。描述与必要说明默认在正文展开，不需要逐卡点击；兼容接入方的 `details` 内容也直接呈现。
- 操作固定属于本卡头部。每张卡按自身容器宽度决定是否折叠，不只看窗口宽度；放不下时显示具名“组件名称操作栏”开关，展开后占头部独立一行，不挤进描述区。这不是历史查询的“更多”入口。
- 关闭的操作栏使用 `inert` / `aria-hidden`，不能被键盘或触屏误触；隐藏布局仍保留固有宽度供测量。真实零宽的隐藏卡不参与错误折叠判断，恢复显示后由 ResizeObserver 重新测量。
- 宽变窄时，将操作区内焦点移回折叠开关；窄变宽时，将开关焦点交回首个可用动作。支持键盘展开，卸载 observer，避免固定宽度反复开合。
- 最外卡有完整 2px 外框、18px 内边距和圆角，明确包围所有内部组件；子卡使用较轻 1px 边框、12px 内边距和内缩。父子名称字号一致，不靠逐层缩小表达层级。桌面连接页旧平铺行样式明确排除 `.component-card`，不覆盖递归卡内边距或将顶边改成 1px。

实现：[ComponentCard.tsx](../app/src/client/maintenance/ComponentCard.tsx)、[maintenance.css](../app/src/client/styles/maintenance.css)、[连接页基础样式](../app/src/client/styles/connect.css)、[连接页布局样式](../app/src/client/styles/connect-layout.css)、[LocalPath.tsx](../app/src/client/LocalPath.tsx)。共享路径组件的并行改动未被本轮覆盖。

## 图标与颜色

四种子卡类型通过显式 `kind` 区分，而不是从名称或嵌套深度猜测：

| 类型 | 本地 Lucide symbol |
|---|---|
| 环境 | `square-terminal` |
| Skill | `book-open-check` |
| MCP | `plug`（既有本地 symbol `i-tool-tool`） |
| 依赖组件 | `package` |

原先选定的七个组件／操作图形不更换、不拉伸、不重画，保留实际着色边界归一、16px 槽位、来源和许可。类型图标底座为 28px，窄卡 26px；普通桌面操作及开关为 30px，触屏及已有 REA 引擎的 44px 目标不缩小，图形本身仍为原 16px。

操作默认使用系统 `--muted`，primary／danger 不单独染橙或红。可用图标悬停、键盘焦点及激活时使用 `--fg` 与中性灰背景，展开开关保持点亮；禁用图标不因悬停点亮。危险确认和错误文字仍保留明确语义；内置工具选中行使用中性灰。

实现：[ComponentGlyph.tsx](../app/src/client/maintenance/ComponentGlyph.tsx)、[原七图资源](../app/src/client/maintenance/component-glyphs.json)、[完整许可](../app/src/client/maintenance/component-glyphs-LICENSE.txt)。

## 环境包含与安装归属

`ComponentCard.environment` 接收递归的 `ComponentEnvironment[]`，每项包含稳定 `id` 与相同 `ComponentCardProps`。需要真实任务传输的子卡通过 `environmentContent` 嵌入原 `BackendMaintenance`，展示位置不改变任务资源或安装责任。

- REA 和 OpenCLI 各自的环境中，Node.js 与 npm 是**并列子卡**。npm 运行依赖 Node.js、随其分发，不表达成 Node.js 依赖 npm；通用组件仍支持继续递归。
- REA 的 Skill、MCP 和全部分析引擎也放在主卡环境内。后台服务包含应用内 Pi，与独立终端 Pi 区分。
- Node/npm 仅显示真实版本与可用检查；安装、重装、卸载仍回到宿主原安装器和原位置整体维护，不伪造独立运行时操作。
- Skill/MCP 沿用原引用接口与 revision；引擎仍按 `rea:<id>` 独立归属。确认、过期校验、外部文件和共享环境保护不变。

实现：[ManagedRuntimeCard.tsx](../app/src/client/maintenance/ManagedRuntimeCard.tsx)、[ReaTool.tsx](../app/src/client/pages/ReaTool.tsx)、[ReaEngines.tsx](../app/src/client/pages/ReaEngines.tsx)、[DesktopUpdates.tsx](../app/src/client/pages/DesktopUpdates.tsx)。

## 真实阶段与结果

后端任务选择仍然是活动优先，否则最新；旧的 `unknown` / `interrupted` 不被后续检查成功掩盖。

1. 活动任务标题按执行器真实阶段显示等待、检查、下载、校验、安装、验证或卸载；取消优先显示“正在取消”。状态徽标表达排队／进行中，避免和阶段标题重复。
2. 只有活动任务的可靠 `downloading` 阶段才显示下载传输信息。旧桌面任务笼统的 `running` 或消息文字不被猜成下载；未知总量区分连接、等待、重试、接收及下载结束，不编造整体百分比。
3. 专属 Node 的 SHA256 校验后、解压前，以及 REA 执行 npm 前，执行端明确进入 `installing` 并清除旧传输；不能用 UI 假文案掩盖执行器漏报阶段。
4. 成功或取消后整块进度／完成面板移除。失败、未知、中断保留明确必要提示；未决操作显示原因、执行端／范围和更新时间，不能冒充仍在执行的进度。
5. 只有接入方提供真实能力才显示核实操作，且绑定原任务；读取旧记录不获得当前安装器恢复权限。“时限与任务详情”是活动控制，不是终态历史查询。

维护卡没有日志、历史列表或终态任务详情入口。桌面内部输出、持久恢复证据、轮询、损坏记录提示与真实恢复旧版本能力仍保留；资源管理页独立历史机制不在本轮移除范围。后端 revision/token、任务归属、提交、清理和进程校验不因阶段文案调整而改变。

实现：[MaintenanceView.tsx](../app/src/client/maintenance/MaintenanceView.tsx)、[InstallProgress.tsx](../app/src/client/pages/InstallProgress.tsx)、[managed-node.ts](../app/src/server/integrations/managed-node.ts)、[rea.ts](../app/src/server/integrations/rea.ts)、[opencli.ts](../app/src/server/integrations/opencli.ts)。

## 验证与边界

- [布局断言](../app/tests/component-layout-helpers.ts)只取最近所属头部，等待布局提交后严格检查名称／头部正宽、名称与路径上下分行及 2px 间距和左缘对齐、相邻操作、版本 DOM 最后／右对齐／窄卡末行，以及路径按钮可见不裁切、头部无横溢出、父子同字号和完整外框。
- [内存卡片回归](../app/tests/maintenance-ui.check.ts)覆盖明暗主题、320/390/1200px、固定窗口改变单卡宽度、折叠临界往返、焦点、超长名称／版本／路径、隐藏后恢复、七阶段与取消优先、未知下载总量、确认与未决状态。复制用页面内 stub，打开路径只调用 fixture 计数，不接触真实系统剪贴板或文件管理器。
- 图标、桌面确认、Pi 更新、REA 引擎、真实工具页与代理维护各有独立离线浏览器回归；触屏尺寸检查先断言真实卡和非空可见动作，再验证至少 44px。
- 桌面只使用合成 IPC；服务及安装测试使用临时 root、离线包和 stub，不维护真实组件。实际 Chrome 打开的也是隔离开发服务，不代表正式 App 已更新。

本轮紧凑分行的 UI、TypeScript 和真实 Chrome 宽／窄屏结果，见[紧凑分行验证报告](../artifacts/component-stacked-header/verification/README.md)。[之前的同行头部验证](../artifacts/component-inline-header/verification/README.md)保留为历史，新要求以标题在上、路径在下为准。[之前的头部与阶段验证](../artifacts/component-header/verification/README.md)及[递归卡片验证](../artifacts/component-nested/verification/README.md)仅保留历史证据，不能替代本轮检查；旧附加服务恢复失败不由这轮布局验收覆盖。
