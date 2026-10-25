# README 视觉素材

## workbench-demo.png

当前源码的真实界面截图，画面中的项目、会话、回答及任务树均为专门创建的示例数据。用于展示阅读布局和任务树，不代表已经调用模型、修改登录流程或通过测试。

截图由 [capture-readme.mts](../../scripts/capture-readme.mts) 生成。脚本使用临时数据目录、独立 Pi 配置和随机服务端口，不连接现有服务；退出时清理临时项目和后台。它会覆盖本目录的图片。

需要 Node.js 22.19.0+。从仓库根目录准备两处依赖后运行：

```sh
npm ci --ignore-scripts
npm --prefix app ci
AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --import tsx scripts/capture-readme.mts
```

根目录依赖供 `scripts/` 中的加载器与导入解析，`app/` 依赖供开发服务和界面使用，不能只安装后一处。根目录使用 `--ignore-scripts` 是为了跳过 `prepare` 自动构建（含原生构建）；截图直接运行源码，不需要这一步。依赖安装会访问网络；下方“不调用模型”仅指截图流程。

`AXIOM_TEST_BROWSER` 可以指向其他本机 Chrome／Chromium 可执行文件。未设置时使用 Playwright 的默认 Chromium，需要预先安装对应浏览器。脚本依赖仓库现有的 `tsx`、`playwright` 及 Pi 包，不要求真实模型凭据。

默认视口为 1440 × 960，浏览器 WebSocket 仅放行截图所需的读取／订阅操作，未知操作会在转发前被拒绝；输出截图前还会检查页面异常和模型执行操作。更新 UI 或文案后应重新运行并人工检查：示例标注是否清楚、任务树是否可见、是否意外包含私人路径／凭据、文字有无被不合理遮挡。时间和临时路径会随重跑改变，不保证逐像素一致。

## 品牌图

首页引用 [app/assets/axiom-icon.svg](../../app/assets/axiom-icon.svg)，沿用项目现有标识，不是新增第三方品牌素材。品牌资产说明见 [app/assets/README.md](../../app/assets/README.md)。
