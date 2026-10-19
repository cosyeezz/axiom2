# 应用品牌图标

`axiom-icon.svg` 是透明背景的金色展翼，也是各端资源的唯一编辑源。主体按可见轮廓等比放大、居中，512×512 画布只留必要安全边距，不包含底板或边框；使用时不要再次裁切或拉伸。

网页工作台、桌面控制页和桌面顶栏通过 `src/client/BrandMark.tsx` 引用这份 SVG，以图片方式保留原渐变，避免被共享线性功能图标的 CSS 改色。工作台标志为38px，旁边采用 AXIOM 2 字标和低对比度“工作台 / WORKSPACE”副行，图形、文字与收起按钮视觉居中。

在仓库根目录运行：

```sh
npm --prefix app run generate:icons
```

生成器使用项目已有的 Playwright；Windows 默认使用 Edge，其他环境可设置 `AXIOM_TEST_BROWSER` 指向已安装的 Chromium 浏览器。它生成：

| 文件 | 用途 |
| --- | --- |
| `app/desktop/icon.png` | 1024px RGBA 桌面打包源，Pake 按平台转换为 ICO／ICNS |
| `app/src/client/public/favicon.svg` | 网页矢量标签图标 |
| `app/src/client/public/favicon.ico` | 16／24／32／48／64／128／256px 的 Windows／浏览器回退图标 |
| `app/src/client/public/apple-touch-icon.png` | 180px Apple 主屏幕入口 |
| `app/src/client/public/icon-192.png`、`icon-512.png` | Web manifest 主屏幕入口，声明为 `any`，不声明 `maskable` |
| `app/android/app/src/main/res/drawable/ic_launcher.xml` | Android 启动图标及原生连接页使用的矢量，保留 SVG 路径、变换和渐变 |

生成资源与源图一同保存；普通构建不依赖浏览器或重新生成资源。网页构建会复制 `public/`，生产服务提供 PNG、ICO、SVG 和 webmanifest 的 MIME 类型。Android 系统可能为非 adaptive 图标添加系统留白；应用内使用完整图案。

修改后分别构建网页、桌面和安卓，并检查小尺寸、透明边角、窄屏品牌区及最终原生包。macOS 的 Pake 转换会添加平台安全留白，最终 Dock 外观需在 macOS 验收。网页与原生客户端分别更新，已安装客户端的系统图标须安装新构建后生效。
