# Axiom2 配置重载图标候选

用户已选择**齿轮右下角带刷新箭头**。产品采用 `settings-reload` 自绘细线适配版：沿用应用原齿轮轮廓，放大主体并让右下角刷新箭头靠近，20px画布与相邻数据图标保持接近的可见尺寸，1.2px非缩放圆角描边与共享灰色；入口和弹窗按钮同源，路径位于 `app/src/client/icons.svg`。候选C01 `mdi:cog-refresh-outline` 为构图参考，产品未使用其填充路径。C02偏同步，C03/C04为实心参考。

浏览器预览：http://127.0.0.1:4398/gallery.html 。页面保留50个候选，前四项为配置与箭头组合，支持16px实际尺寸。

新增4个MDI SVG均从官方仓库下载，HTTP200、XML解析及SHA256验证；图标Apache-2.0声明见mdi_license.txt。其他46个保留既有Lucide ISC、Tabler/Iconoir MIT许可。MDI以填充路径形成轮廓，预览只使用currentColor，不改原始路径。官网链接不等于已逐页验证。

| 编号 | 图标 | 含义 | 官网 | 官方SVG | 许可 |
|---|---|---|---|---|---|
| C01 | `mdi:cog-refresh-outline` | 配置重新加载（线框） | [官网](https://pictogrammers.com/library/mdi/icon/cog-refresh-outline/) | [SVG](https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cog-refresh-outline.svg) | Apache-2.0 |
| C02 | `mdi:cog-sync-outline` | 配置同步（线框） | [官网](https://pictogrammers.com/library/mdi/icon/cog-sync-outline/) | [SVG](https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cog-sync-outline.svg) | Apache-2.0 |
| C03 | `mdi:cog-refresh` | 配置重新加载（实心） | [官网](https://pictogrammers.com/library/mdi/icon/cog-refresh/) | [SVG](https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cog-refresh.svg) | Apache-2.0 |
| C04 | `mdi:cog-sync` | 配置同步（实心） | [官网](https://pictogrammers.com/library/mdi/icon/cog-sync/) | [SVG](https://raw.githubusercontent.com/Templarian/MaterialDesign/master/svg/cog-sync.svg) | Apache-2.0 |
| R05 | `lucide:rotate-cw` | 顺时针单箭头重载 | [官网](https://lucide.dev/icons/rotate-cw) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/rotate-cw.svg) | ISC |
| R06 | `lucide:rotate-ccw` | 逆时针单箭头重载 | [官网](https://lucide.dev/icons/rotate-ccw) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/rotate-ccw.svg) | ISC |
| R07 | `lucide:repeat` | 循环加载 | [官网](https://lucide.dev/icons/repeat) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/repeat.svg) | ISC |
| R08 | `lucide:repeat-1` | 单次循环 | [官网](https://lucide.dev/icons/repeat-1) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/repeat-1.svg) | ISC |
| R09 | `lucide:repeat-2` | 双路径循环 | [官网](https://lucide.dev/icons/repeat-2) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/repeat-2.svg) | ISC |
| R10 | `lucide:settings` | 齿轮配置 | [官网](https://lucide.dev/icons/settings) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/settings.svg) | ISC |
| R11 | `lucide:settings-2` | 双滑块配置 | [官网](https://lucide.dev/icons/settings-2) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/settings-2.svg) | ISC |
| R12 | `lucide:sliders-horizontal` | 横向配置滑块 | [官网](https://lucide.dev/icons/sliders-horizontal) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/sliders-horizontal.svg) | ISC |
| R13 | `lucide:sliders-vertical` | 纵向配置滑块 | [官网](https://lucide.dev/icons/sliders-vertical) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/sliders-vertical.svg) | ISC |
| R14 | `lucide:file-cog` | 配置文件 | [官网](https://lucide.dev/icons/file-cog) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/file-cog.svg) | ISC |
| R15 | `lucide:folder-cog` | 配置目录 | [官网](https://lucide.dev/icons/folder-cog) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/folder-cog.svg) | ISC |
| R16 | `lucide:package` | 资源包 | [官网](https://lucide.dev/icons/package) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/package.svg) | ISC |
| R17 | `lucide:package-open` | 打开资源包 | [官网](https://lucide.dev/icons/package-open) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/package-open.svg) | ISC |
| R18 | `lucide:folder-sync` | 目录同步 | [官网](https://lucide.dev/icons/folder-sync) | [SVG](https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/folder-sync.svg) | ISC |
| R19 | `tabler:refresh` | 双箭头刷新 | [官网](https://tabler.io/icons/icon/refresh) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/refresh.svg) | MIT |
| R20 | `tabler:refresh-dot` | 刷新状态点 | [官网](https://tabler.io/icons/icon/refresh-dot) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/refresh-dot.svg) | MIT |
| R21 | `tabler:refresh-alert` | 刷新告警 | [官网](https://tabler.io/icons/icon/refresh-alert) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/refresh-alert.svg) | MIT |
| R22 | `tabler:refresh-off` | 禁用刷新 | [官网](https://tabler.io/icons/icon/refresh-off) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/refresh-off.svg) | MIT |
| R23 | `tabler:reload` | 单箭头重新加载 | [官网](https://tabler.io/icons/icon/reload) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/reload.svg) | MIT |
| R24 | `tabler:rotate` | 逆时针旋转 | [官网](https://tabler.io/icons/icon/rotate) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/rotate.svg) | MIT |
| R25 | `tabler:rotate-clockwise` | 顺时针旋转 | [官网](https://tabler.io/icons/icon/rotate-clockwise) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/rotate-clockwise.svg) | MIT |
| R26 | `tabler:rotate-2` | 分段逆时针旋转 | [官网](https://tabler.io/icons/icon/rotate-2) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/rotate-2.svg) | MIT |
| R27 | `tabler:rotate-clockwise-2` | 分段顺时针旋转 | [官网](https://tabler.io/icons/icon/rotate-clockwise-2) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/rotate-clockwise-2.svg) | MIT |
| R28 | `tabler:rotate-360` | 360度旋转 | [官网](https://tabler.io/icons/icon/rotate-360) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/rotate-360.svg) | MIT |
| R29 | `tabler:repeat` | 重复执行 | [官网](https://tabler.io/icons/icon/repeat) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/repeat.svg) | MIT |
| R30 | `tabler:repeat-once` | 执行一次 | [官网](https://tabler.io/icons/icon/repeat-once) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/repeat-once.svg) | MIT |
| R31 | `tabler:repeat-off` | 禁用重复 | [官网](https://tabler.io/icons/icon/repeat-off) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/repeat-off.svg) | MIT |
| R32 | `tabler:settings` | 齿轮设置 | [官网](https://tabler.io/icons/icon/settings) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/settings.svg) | MIT |
| R33 | `tabler:settings-2` | 替代齿轮设置 | [官网](https://tabler.io/icons/icon/settings-2) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/settings-2.svg) | MIT |
| R34 | `tabler:adjustments` | 纵向调整 | [官网](https://tabler.io/icons/icon/adjustments) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/adjustments.svg) | MIT |
| R35 | `tabler:adjustments-horizontal` | 横向调整 | [官网](https://tabler.io/icons/icon/adjustments-horizontal) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/adjustments-horizontal.svg) | MIT |
| R36 | `tabler:file-settings` | 文件设置 | [官网](https://tabler.io/icons/icon/file-settings) | [SVG](https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/file-settings.svg) | MIT |
| R37 | `iconoir:refresh` | 单箭头刷新 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/refresh.svg) | MIT |
| R38 | `iconoir:refresh-double` | 双箭头刷新 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/refresh-double.svg) | MIT |
| R39 | `iconoir:refresh-circle` | 圆形刷新入口 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/refresh-circle.svg) | MIT |
| R40 | `iconoir:restart` | 重新开始 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/restart.svg) | MIT |
| R41 | `iconoir:system-restart` | 系统重启 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/system-restart.svg) | MIT |
| R42 | `iconoir:reload-window` | 窗口重新加载 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/reload-window.svg) | MIT |
| R43 | `iconoir:settings` | 齿轮设置 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/settings.svg) | MIT |
| R44 | `iconoir:settings-profiles` | 配置档案 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/settings-profiles.svg) | MIT |
| R45 | `iconoir:ios-settings` | 系统设置滑块 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/ios-settings.svg) | MIT |
| R46 | `iconoir:database-settings` | 数据库设置 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/database-settings.svg) | MIT |
| R47 | `iconoir:folder-settings` | 文件夹设置 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/folder-settings.svg) | MIT |
| R48 | `iconoir:cloud-sync` | 云端同步 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/cloud-sync.svg) | MIT |
| R49 | `iconoir:package` | 资源包 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/package.svg) | MIT |
| R50 | `iconoir:packages` | 多个资源包 | [官网](https://iconoir.com/) | [SVG](https://raw.githubusercontent.com/iconoir-icons/iconoir/main/icons/regular/packages.svg) | MIT |
