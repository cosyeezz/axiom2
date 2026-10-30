# 会话文件预览

助手回复中的真实本地文件链接可在会话右侧打开。默认读取／展示，HTML 预览默认启用页面脚本与普通联网，不自动启动项目；预览保留输入草稿，不调用模型。技能文件继续使用独立技能身份授权，不提供项目执行入口。

## 支持范围

直接链接的本地文件不再设置固定输入大小上限，包括原先文本1 MiB、图片／PDF 8 MiB、音视频16 MiB及Office／归档32 MiB门槛。大文件仍受可用内存、请求超时及格式解析能力影响；编辑、归档展开和HTML伴随资源的独立安全预算保持不变。

| 文件 | 展示方式 | 主要限制 |
| --- | --- | --- |
| Markdown、代码、文本 | 源码、行号；Markdown 阅读／分栏；UTF-8 可编辑 | 普通文本编辑最多1 MiB、技能128 KiB，超出仅预览；UTF-16 BOM、GB18030仅预览；长 Markdown 超过20万字符使用完整源码 |
| PNG/JPEG/GIF/WebP、PDF | 图片缩放／适应，浏览器 PDF 阅读器 | PDF依赖浏览器／WebView |
| MP3/WAV/FLAC/Ogg/AAC、MP4/WebM | 原生音视频播放器 | 不自动播放；容器／编码须受浏览器支持，失败显示原因 |
| DOCX/XLSX/PPTX | Word正文／表格、Excel工作表、PPT文字 | 内容阅读而非版式还原，不展示图片／图表，不执行宏、公式或外链；旧doc/xls/ppt、加密格式不支持 |
| ZIP/TAR/TGZ/TAR.GZ/GZ | 搜索目录、按需成员只读预览、返回目录 | 不落盘、不执行、不递归嵌套包；不支持RAR/7z、加密、链接、特殊成员及TAR扩展头 |
| HTML | 默认启用脚本与普通联网的隔离预览、源码／分栏；开关可直接切换 | 静态资源有界加载；复杂模块／动态接口可使用独立运行模式 |

Office XML 仅选择白名单部件，拒绝 DOCTYPE/ENTITY，单部件2 MiB、总8 MiB；客户端限制深度128、10万个XML节点，最多100页／表、200行×50列、正文20万字符。Excel公式只显示已有缓存值或公式说明，不计算。

归档最多2000项、声明／实际展开上限128 MiB、单选成员8 MiB、每次选中合计32 MiB。ZIP选中成员检查大小及CRC；GZIP流式解压可取消；TAR验证校验和、成员边界和结束块。成员请求携带父归档SHA-256修订，变更后须返回重新加载；每次请求重新检查原会话链接授权。归档成员不提供保存或运行入口。

## 图片缩放

- 在图片预览区域滚动鼠标滚轮即可围绕鼠标位置放大／缩小；无需按住 Ctrl，触控板细小滚动也按连续比例处理。普通 100px 滚轮步长约改变当前比例的 5%，极大单次输入有界，默认有短缓动并尊重减少动态效果设置。
- 工具栏加减每次调整 **5 个百分点**，从当前实际显示比例开始，以视口中心为锚点，不再将“适应”误当作100%。缩放范围5%–300%；若大图的适应比例低于5%，允许降回该适应比例，首次滚动不会跳变。
- 小于视口的图片同样保持鼠标下的内容位置；放大后可用原生滚动条浏览局部。“适应窗口”取消缩放动画、恢复居中并在窗口尺寸变化时自动适应。

## HTML 文件预览

- 允许 HTML 根目录树内的相对 CSS／JS、图片、字体，以及解析后仍位于该树内的 `../`；禁止越界、隐藏路径、绝对／远程文件路径、符号链接和硬链接。
- 支持 `srcset`、内联／外部 CSS `url()`、有界递归 `@import`，保留媒体条件；图片支持 PNG/JPEG/GIF/WebP/BMP/ICO/AVIF 与受限静态 SVG，字体支持 WOFF/WOFF2/TTF/OTF。
- CSS／JS最多16份、单份1 MiB、合计2 MiB；图片／字体最多48份、单份2 MiB；全部原始资源8 MiB。CSS展开和累计替换12 MiB、依赖边512，最终页面16 MiB。循环、缺失、拒绝或超限会提示。
- 双层 iframe 默认允许页面脚本、始终不授予同源权限；普通联网也默认允许，无需点击同意。可随时停用脚本或禁止普通联网，再次开启无需确认；重新加载／关闭重开恢复默认允许。
- CSP 默认允许 HTTP(S) 资源及 HTTP(S)／WS(S) 连接，跨域仍受 CORS 限制；页面跳转、嵌套远程页面与表单提交仍禁止。关闭普通联网后阻止常见外部请求，但 **CSP不能阻止WebRTC等所有脚本网络能力**，不能把脚本模式称为完全离线。

## 独立网页／项目运行

在 HTML、package.json 或目录预览中点击 **网页／项目运行**，读取配置后确认：

1. **网页模式**：在独立HTTP端口直接提供目录树中的白名单资源，支持模块图、内联模块、importmap、动态import、fetch/XHR及常见DOM资源URL。
2. **项目模式**：展示并执行package.json中选定的npm script；不自动安装依赖，使用`npm --ignore-scripts run`，不触发npm pre/post hooks。Vite/Next dev自动传入loopback及分配端口，其他启动脚本须读取`PORT`/`HOST`。脚本须留在前台，不能自行daemonize。

两个模式均使用独立origin、随机令牌路径、双层无同源sandbox，不能访问工作台DOM、存储或凭据；每请求核验原会话授权。不会向项目上游转发工作台Cookie/Authorization，也不跟随外部重定向。普通联网开关仅控制浏览器常见资源及connect请求，跨域仍受CORS限制。

**项目是真实本机进程，不是操作系统沙箱。** 它可以读写磁盘、启动程序和联网，不受浏览器联网开关约束。只有确认可信项目才启动；白名单环境、临时HOME、进程组清理不能代替OS隔离，主动脱离进程组的恶意后代不在保证范围内。

运行限制：

- 至多3个实例，每会话1个；每资源／上游响应16 MiB、JavaScript解析8 MiB（按UTF-8字节，含内联sourcemap）、请求体2 MiB，每分钟128 MiB，8执行＋64等待。
- 窗口每10秒续租，失联约2分钟停止，总寿命30分钟。停止、关闭预览、撤销授权或服务关闭会撤销令牌、关闭端口、回收正常进程树并清理临时目录。
- 支持停止、刷新、配置重新读取、尾部日志；源码保存后可刷新网页。更改运行模式／联网选项须先停止。
- 不是通用打包器或透明反向代理：暂不支持WebSocket/HMR、流式长连接、Cookie登录、Service Worker／同源存储；特殊框架或其他URL API可能仍需配置base。离线外部依赖不可凭空提供。
- 本机及启用的Tailscale HTTP地址可访问；HTTPS工作台会遇到HTTP混合内容限制。不能把这些实现边界解释为技术上永远无法支持。

## 验证

图片焦点缩放已通过13项相关单测、类型检查和隔离前端构建；[专项浏览器检查](../app/tests/image-zoom.check.ts)在Chrome与WebKit均通过，覆盖小图／超大图的精确鼠标锚点、平滑且无遗留RAF、细微／反向／连续滚轮、5个百分点按钮、上下限、原生滚动后resize、Ctrl-wheel、减少动态效果、缓存切图、解码失败和卸载。[完整文件预览回归](../app/tests/file-preview.check.ts)九视口也通过。截图：[Chrome](../test-results/image-zoom-chromium/)、[WebKit](../test-results/image-zoom-webkit/)、[集成](../test-results/image-zoom-integration/)。仅隔离验证，未部署或重启正式服务；构建存在非阻断的大chunk提示。

移除输入门槛的回归：18项相关单测、类型检查和Chrome预览回归通过，涵盖1 MiB编辑边界、超限中文文本／Markdown／代码／HTML全文、超过8 MiB的PDF、超过32 MiB的ZIP目录及保留成员展开保护。浏览器精确比对5 MiB单行文本与结尾、只读提示，并保留250 KB编辑保存验证。日志与截图位于 `test-results/preview-no-size-limit/`；本次未部署或重启正式后台。

在`app/`执行，测试使用临时目录、数据和动态端口，不连接正式4317、不安装依赖、不运行用户项目：

```bash
TMPDIR=/private/tmp node --import tsx --test \
  tests/preview-runtimes.test.ts tests/preview-formats.test.ts \
  tests/file-preview.test.ts tests/file-edit.test.ts tests/html-assets.test.ts

TMPDIR=/private/tmp \
AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
AXIOM_TEST_ARTIFACTS=/private/tmp/axiom-expanded-preview-ui97 \
node --import tsx tests/file-preview.check.ts
```

已通过25项单元测试、Chrome九视口回归、类型检查和隔离前后端构建。浏览器覆盖Office三格式、真实WAV／生成WebM解码、归档成员只读、当时默认禁脚本及关闭重置（现已改为默认允许，见上文）、12依赖模块图、动态import／fetch、独立origin隔离、显式临时项目启动及端口回收。运行服务单元验证确认／修订冲突、越界／链接拒绝、撤权、并发队列、相对重定向、npm hooks不执行、敏感环境与凭据不透传、正常父子进程回收、启动中取消；这些结果不等于所有格式、框架及操作系统均已验证。

另以自造Vite 8.3.4／React JSX项目完成真实浏览器探针：双层sandbox中渲染、点击更新状态、页面内fetch JSON及停止后双端口回收均通过，pageerror为0。React DOM开发模块含内联sourcemap约3.2 MB，已修复旧2 MiB解析上限导致的403；新8 MiB UTF-8上限另有大模块、恰好边界及超限拒绝单测。Vite HMR WebSocket仍不支持，不能将页面可运行等同于完整开发服务器兼容。

本轮产物：`/private/tmp/axiom-expanded-units97-final.log`、`/private/tmp/axiom-expanded-preview-ui97-final/`、`/private/tmp/axiom-expanded-build97/client/`、`/private/tmp/axiom-expanded-build97-final/server/`、`/private/tmp/axiom-vite-probe97/`。仅隔离构建，未覆盖正式dist、未重启／部署正式服务。
