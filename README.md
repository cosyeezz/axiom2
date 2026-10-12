# Axiom2

基于 pi 的本地多工作空间 Agent 工作台。当前完成第一阶段的**步骤一运行基础**，不是完整编码 Agent 产品。实施与验收依据：[产品设计](docs/design.md)；设计状态见 [UI 设计同步](docs/ui-sync.md)。文档只描述当前状态，变更轨迹由 Git 保存。

## 当前可用范围

- React 工作台、配置概览、模型服务三个独立页面，沿用设计 CSS、SVG 和响应式布局。
- 本地回环 HTTP/WebSocket 服务、启动链接授权、来源校验、分作用域快照订阅；重连不自动重发操作。
- 通过绝对路径确认和显式授权打开工作空间；创建、切换、搜索、重命名、置顶及删除会话索引。删除不删除项目文件。
- 文本与代码附件草稿按查看实例、工作空间、会话隔离。浏览器 sessionStorage 恢复同标签页草稿，SQLite 保存已确认的草稿副本；尚无跨查看实例的服务端草稿恢复界面。
- 配置概览读取独立 pi 配置目录的供应商／模型数量；可用目录取明确配置与 pi 可用模型的交集，不回传密钥。
- 模型服务页面可编辑**仅保存在本页内存的未发布草稿**，验证顶部统一保存布局、思考等级多选及名称／ID 复制；实际保存、读取现有配置进行编辑、API Key/OAuth 与退出登录尚未接入。

**未完成：**真实主 Agent、运行中的模型选择、工具展示、用量、pi 对话恢复、子 Agent 调度与弹窗、预览评论、Pake 和跨平台验收。发送和配置发布均禁用，服务端拒绝 prompt，不产生模拟回复。双击会话或 F2 可重命名；Delete 弹出删除确认，触屏会话管理待补齐。

## 启动

需要 Node.js 24+ 与 npm。当前实测 Windows、Node.js 24.19.0、npm 11.17.0；macOS/Linux 尚未实机验收。

```sh
cd app
npm ci
npm run build
npm start
```

打开终端显示的 `http://127.0.0.1:4317/#access=…` 完整访问链接。片段令牌交换为 HttpOnly / SameSite cookie 后从地址栏移除；请勿分享访问链接。服务重启后使用新的启动链接授权。

开发模式：`cd app && npm run dev`。可设置 `AXIOM_PORT`（默认 4317，0 为动态端口）与 `AXIOM_DATA_DIR`（明确指定数据根目录）。页面入口：`/`、`/settings.html`、`/model-config.html`。

默认数据目录：Windows `%APPDATA%/Axiom2`；macOS `~/Library/Application Support/Axiom2`；Linux `$XDG_DATA_HOME/Axiom2` 或 `~/.local/share/Axiom2`。SQLite 位于该目录，pi 文件位于其 `pi/` 子目录，不修改终端 pi 的默认配置或项目文件。现有 models.json 摘要在服务启动时读取；外部修改后需重启。配置目录使用当前用户权限，不承诺磁盘加密或系统密钥库。

## 检查

```sh
cd app
npm run build
npm test
npm run check:sdk
npx playwright install chromium
npm run check:ui
```

已有浏览器可通过 `AXIOM_TEST_BROWSER` 指定可执行文件路径。截图与几何报告写入 `app/test-results/`，不写入 `ui/`。

已通过：SQLite 归属、授权、幂等、修订冲突、重启与写入失败回滚；HTTP/WebSocket 来源与访问检查、回执查询；配置目录筛选与敏感值不回传；三个页面在设计规定的九个视口无横向溢出；工作空间／会话／草稿切换、刷新、中文组合输入、多选与复制。

`check:sdk` 使用**回环协议测试夹具**验证已安装 pi 的创建会话、API Key 登录／退出、四个独立工具注册、流式／工具事件、会话文件恢复和运行中停止。测试工具不接入产品调度，不代表子 Agent 已实现；未验证真实供应商、OAuth 或实际编码闭环。浏览器检查不等于完整 UI-01 验收，子会话、运行状态及完整视觉对照仍待完成。

## 目录与设计维护

- `ui/`：用户设计源，只读。
- `app/src/`：产品开发代码；`app/tests/`：自动检查。
- `app/` 根目录原有 HTML、图片与检查脚本：保留的原型副本，不是产品运行入口。
- `docs/design.md`：第一阶段目标、架构、接口与验收约束。
- `docs/ui-sync.md`：当前采用提交、同步状态与检查方式。
- 根目录 ZIP：保留的用户交付包，不自动重打包。

设计更新先单独提交，再按 Git 差异移植至 `app/`，不整目录覆盖已接入功能。当前仅使用本地 Git，不创建远端或推送。
