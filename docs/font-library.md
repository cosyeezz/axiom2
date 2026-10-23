# 字体库来源与交互

“显示与阅读”保留当前字体和浏览入口，字体库使用独立窗口。桌面左侧是搜索、语言／风格筛选及列表，右侧是所选字体的可编辑试阅；窄屏切换列表和详情，返回时保留搜索与列表位置。列表每次展示60项，可继续加载。字体名称的小样仅对可见行加载，不使用整份中文字体来绘制列表。

## 参考项目

本次实际读取官方源码及网页，借鉴交互，不复制其实现：

- [Penpot typography.cljs](https://github.com/penpot/penpot/blob/9aa78a536b35e8c7832e99d760b3aed024ffc162/frontend/src/app/main/ui/workspace/sidebar/options/menus/typography.cljs)：搜索、紧凑字体列表、字体自身样张、键盘导航，以及字体选择和管理分开。
- [WordPress Gutenberg Font Library](https://github.com/WordPress/gutenberg/tree/fa27521a0a49938d962df9d1f0fdfc68ea233fce/packages/global-styles-ui/src/font-library)：独立字体窗口，安装／上传／已添加分区，名称搜索、分类、样张和详情安装操作。
- [Google Fonts](https://fonts.google.com/)：语言、书写系统、风格筛选，自定义样张与字号。只采用适合阅读设置的筛选，没有照搬完整设计工具的可变轴与排版控制。

## 数据快照

`app/src/client/font-catalog.json` 保存1,942个字体家族，其中26款由官方元数据标注支持中文。中文包括简体、繁体和香港字体；该标注不保证每款都覆盖全部汉字。目录包括1,907款 SIL OFL 1.1 和35款 Apache 2.0 字体。

- Google Fonts 固定提交：[`e7db6ca603fd4862010383ff17ffd6cc4ffac1c0`](https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0)。字体文件、家族元数据和许可来自此提交。
- [Fontsource 官方只读 API](https://api.fontsource.org/v1/fonts)用于收集候选名称、类别和稳定ID；最终名称、分类、语言支持、完整字体文件和许可与 Google Fonts 元数据核对。Fontsource 原始快照 SHA-256 为 `8762f82b4c7fbc78263c768a80c79b1f10f937ba2b99fcb6c4e8a023585fab7c`。
- 候选文件必须是家族目录内的完整 TTF／OTF，存在可验证的许可文件，单文件不超过30,000,000字节。优先正常样式和400字重，排除仅能取得超限文件的家族。没有使用中文网页字体分片充当完整字体。
- 每项保留真实文件路径、大小、Git blob SHA、许可路径、样式和变量字体标记。下载 URL 按固定提交与编码后的路径生成，不依赖运行时目录 API或密钥。
- 已有 `custom:noto-sans-sc`、`custom:noto-serif-sc`、`custom:inter`、`custom:lora` ID保留；旧设备保存的字节不自动替换。新下载改用目录中的完整 TTF，大小以界面显示为准。

更新时应重新固定 Google Fonts 提交，读取完整且未截断的 tree，按家族元数据匹配 Fontsource 候选，校验许可文件内容和 Git blob 哈希，筛除超限／不匹配记录并去重。保留既有ID；目录变化需运行 `tests/font-catalog.test.ts`，并抽查中文完整字库、CORS及浏览器解码，不可只验证URL格式。

## 加载和保存

列表名称通过 Google Fonts CSS2 的 `text` 参数请求小型字形子集；只有可见行请求，离屏或关闭后回收注册对象。服务不可达时保留可搜索的普通名称，完整字体下载仍可独立重试。该小样服务未固定版本，因此列表小样可能与固定版本的完整字体有细微差异；详情预览和实际应用使用同一份固定版本文件。

点击字体后在详情加载完整字体，预览不加入已添加字体，也不改变当前应用字体。“下载字体”将字节保存到当前设备的 IndexedDB，之后点击“使用字体”才切换。导入也不自动应用。支持进度、取消、180秒超时、错误重试和30MiB文件上限；写事务提交前可以取消，已完成的保存不会因稍后的关闭而撤销。

保存的字体刷新后可离线恢复，同源窗口同步；移除当前字体回到默认，恢复默认设置保留字体库。关闭或切换候选时释放未保存预览；代码仍使用原等宽字体。变量字体声明其字重范围，让正文400和标题字重参与浏览器匹配，不使用文件中较细的默认实例。

## 验证范围

目录源文件及许可已核验；抽样核对 Noto Sans SC、Noto Serif SC、LXGW WenKai TC、Inter、Lora、Aclonica 的完整字体字节和哈希，Inter与ZCOOL KuaiLe额外核对带 Origin 的 GET/CORS。没有逐款下载全部字体，也未验证中国大陆网络可达性。

`tests/fonts.check.ts` 使用真实 FontFace 和 IndexedDB、受控网络响应验证搜索、筛选、分页、预览、下载与使用分离、持久化、离线恢复、取消、错误重试和跨窗口操作；该专项及完整应用 `tests/display-settings.check.ts` 均已在系统Chrome通过。目录／显示／主题单测13项、类型检查、隔离Vite构建通过。已审阅桌面与320px手机、深浅主题的字体库截图。专项中的不同在线字体统一使用Inter测试字节，因此截图用于布局与交互验收，不用于确认各家族的实际字形。

独立真实字体校验额外覆盖Noto Sans SC、Noto Serif SC和Inter：16px／32px、光学尺寸auto／none下，正文400与显式`"wght" 400`均为零像素差异，并区别于低字重和700；浏览器确认实际使用自定义字体。Google CSS2 `text=Inter` 和gstatic实际GET／跨域fetch均为200，1320字节WOFF2成功解码并实际渲染Inter五个字形。此项只抽查该名称子集，不代表全部在线小样可达。浏览器结果不代替原生WebView验收。
