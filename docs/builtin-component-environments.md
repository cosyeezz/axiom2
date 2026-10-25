# 内置组件的独立运行环境

Axiom 管理四类内置组件：REA、OpenCLI、RTK、模型代理。安装和运行不再要求它们与 Axiom 后台共用同一套 Node/npm，也不修改系统 PATH、全局 npm/pip、系统 Java 或其他程序的运行环境。

这是**进程运行环境与组件状态隔离**，不是容器或安全沙箱：HOME、系统凭据、证书、浏览器配置和外部命令仍按工具需求可用。用户自行运行的终端、其他 MCP 和 Agent 的普通 Python/Node 命令不切换到组件运行时。

## 组件布局与启动

以下路径均相对于 Axiom 应用数据目录，而非项目工作区。

| 组件 | 程序与依赖 | 运行环境 |
| --- | --- | --- |
| REA | `integrations/rea/versions/v<版本>-<UUID>/node_modules/rea-agents` | 同一版本目录下的私有 Node/npm、`runtime.json`、`environment/` |
| OpenCLI | `integrations/opencli/versions/v<版本>-<UUID>/node_modules/@jackwener/opencli` | 同一版本目录下的私有 Node/npm、`runtime.json`、`environment/`、`commands/` |
| RTK | `integrations/rtk/versions/` 中的本机平台二进制 | `integrations/rtk/environment/`；本组件独占的数据库变量 |
| 模型代理 | `integrations/model-proxy/versions/` 中的 mihomo/Xray 二进制 | 安装自检使用候选目录的 `environment/`；运行线路使用各自 `runs/<generation>/environment/` |

Node 发行包位于候选版本目录的 `runtime/node-v<版本>-<系统>-<架构>/`。macOS/Linux 直接使用该包的 `bin/node` 和 `lib/node_modules/npm/bin/npm-cli.js`，Windows 使用 `node.exe` 与 `node_modules/npm/bin/npm-cli.js`。Axiom 自身的监督 JS 仍由后台 Node 执行，真正的 npm、工具程序、MCP、REA doctor 则显式使用绑定的私有 Node。

OpenCLI 的 Agent PATH **只增加 `commands/`**，不加入私有 Node/npm 目录。launcher 在子进程内才准备私有 PATH 和环境；因此 Agent 执行普通 `node`、`npm`、`python` 的含义不变。POSIX、cmd 与 PowerShell 入口均绑定同一个 Node 和工具入口，并在发布前用实际命令验证版本。launcher 不持久化安装时代理 URL 或凭据；它从执行时工具环境取得代理。

原生 RTK/代理不安装 Node。模型代理的自检、导入和临时验证不再复用 RTK runner，因而不会继承 RTK 数据库与遥测控制变量。

## 环境边界

组件子进程保留必要的系统 PATH，在需要时仅向**本子进程**前置私有 Node。组件拥有自己的 XDG config/cache/data/state、APPDATA/LOCALAPPDATA、临时目录及 npm 缓存。npm 的用户与全局配置指向组件私有位置，不使用用户全局 prefix、registry 或脚本配置。

启动时移除继承的 Node 模块/启动注入、npm 配置注入、Python/虚拟环境、Ruby/Perl、Java 选项与 CLASSPATH、RTK 专用变量；RTK runner 随后只补回自身所需变量。已有显式 REA 引擎路径只作用于 REA 子进程。模型网络环境与工具网络环境沿用 Axiom 原有分离机制，不将模型专用代理凭据写入组件 launcher。

内置 REA 的正式 MCP 和安装诊断使用一致的已解析环境、工作目录及 `inheritEnv: false`。环境值中的 `$`、`!` 等按字面传入，不能再次当作用户 MCP 配置表达式执行；用户自定义 MCP 仍保留 Pi 文档规定的插值和配置命令语义。

## 安装、检查和切换

1. 检查更新取得目标工具的精确稳定版本；REA 可展示尚未适配的新版本，但安装目标必须命中已核验的依赖契约表。
2. 从 npm 官方精确版本元数据读取 `engines.node`，从 Node 官方发行索引选择满足要求、具有本平台/架构资产的 LTS 版本。不使用后台 Node 猜测是否能装，也不靠 `--force` 跳过引擎检查。
3. 下载 Node 官方归档和 `SHASUMS256.txt`，校验 SHA-256，受限安全解包，再实际执行私有 Node/npm 的版本自检。下载仅允许官方 HTTPS 地址；没有满足要求的 LTS 资产则明确失败，旧安装不变。
4. 使用该私有 npm，在全新版本目录执行带 `--engine-strict` 的局部安装。REA 保留其所需安装脚本与原生可选依赖；OpenCLI 仍禁用安装脚本。
5. 验证目标包、技能与入口。REA 实际连接 MCP、核对服务版本与工具列表，并调用 `binary_session`；OpenCLI 验证实际私有命令与 launcher 的版本。
6. 取消检查、配置修订与目录归属复核通过后，原子发布配置指向新版本。**发布前**失败、取消或冲突清理本次未发布候选，不改变原配置。

配置 rename 已成功而后续目录 fsync 等确认失败时，配置可能已切换。任务必须明确报告“已切换、后续确认未完成”，保留新安装并要求刷新核实；不能删除已发布目录或谎称旧版本仍在使用。

更新不删除成功的旧程序或引擎目录。**REA/OpenCLI 已加载的资源及已启动子进程保留原绑定**，不会在执行中替换其 Node、程序或依赖。显式资源重载、新建 worker、后台重启后的冷恢复按当时已发布配置重新绑定；当前没有“冷恢复自动还原历史工具版本”的会话级快照保证。RTK 每次过滤重新读取配置，同一 worker 的后续过滤可以使用新版本，但已启动的过滤进程不会被热替换；模型代理按线路 generation 管理已启动内核。全量卸载仍受现有在途任务与进程归属检查保护。

无 `runtime` 字段的历史安装仍按原方式运行，不在启动/刷新时静默迁移，也不自动升级共享后台 Node。界面标记旧共享环境，重新安装或更新成功后才转为私有环境。私有绑定损坏时明确报错，不回退到系统 Node。界面的安装平台支持与旧安装的运行兼容性分别判断：旧 Node 不兼容可以提示修复，但不能禁用私有运行时安装入口。

## 运行时完整性

`runtime.json` 绑定 Node/npm 版本、目标工具的 Node range、系统/架构、官方归档 SHA-256，以及解包后文件身份。检查拒绝路径逃逸或符号链接替换，并复核 Node、npm 入口和**整个 npm 实现树**（包含 `lib/`、`package.json`、bundled dependencies）的文件/目录身份摘要。增加、删除或改写 npm 实现，即使 `npm-cli.js` 未变也会失败。

收据是有预算的本地身份检测，不是签名、文件系统原子快照或对能同时重写安装与收据的本机恶意用户的安全边界。归档 SHA-256 用于官方分发完整性。大 Node 二进制不作为普通技能资源内容反复读取；资源身份包含运行时收据与 launcher。Axiom 在安装验证、资源加载及显式解析组件 Node 时复核绑定；OpenCLI 的独立 launcher 本身不在每次调用时重新读取收据或扫描 npm 树，不能承诺资源加载后篡改也总在每次启动前被发现。

## REA 依赖契约

仅明确核验的版本进入 `reaEngineProfiles`，不因版本号较新就沿用旧策略。当前为：

| REA | 官方 `engines.node` | Ghidra | JADX Headless MCP | WABT | Java |
| --- | --- | --- | --- | --- | --- |
| 6.7.0 | `^22.19.0 \|\| ^24.11.0 \|\| >=26.0.0` | 验证 12.1.4；接受 12.1 系列 | 固定 0.7.1 | 固定 1.0.42 | 推荐完整 64 位 JDK 21 |
| 6.8.0 | `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1` | 同上 | 同上，使用该 REA 包自己的桥接文件 | 同上 | 同上 |

- JDK 取 Adoptium 21 的已确认修订，不盲取最新主版本。JADX 要求 Java 17+ 和 `jdk.compiler`；Ghidra 最终按安装包声明的 Java 上下界与架构验证。通用 Java 卡显示兼容不等于 Ghidra doctor 已通过。
- Ghidra 接受上游版本拼写（如 `12.1`、`12.1.5-DEV`、`12.1.4+build`），不把任意新主/次版本当兼容。
- JADX 生产引擎版本与 REA-owned 桥接 identity 不是同一概念：6.7.0→6.8.0 的桥接 identity 从 4→7，但引擎仍为 0.7.1，不能跨 REA 版本混用包内桥接文件。固定 JAR SHA-256：`6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`。
- WABT 明确检查 `wasm-validate`、`wasm-objdump`、`wasm2wat` 的精确 1.0.42 banner。
- Hopper 没有已证实的 REA 固定版本范围，保持兼容性 unknown，许可、平台支持及实际桥接另行核实，不承诺 latest 兼容。
- 未适配 REA 版本的自动程序安装和配套依赖推荐/安装明确拒绝，不静默使用 latest 依赖。已有外部组件文件不会被覆盖或全局重配。

引擎维护在独立候选目录验证后才切换对应路径，确认绑定当前 REA 版本及组件修订；切换 Java 会使相关 Ghidra/JADX 检查失效并重验。REA 主程序更新保留既有引擎路径与下载登记，但旧引擎检测结果失效，回到待检查；程序 MCP 连接成功不等于目标版本的 provider doctor 已通过，需另行检查配套组件。具体平台和引擎安装边界见 [REA 分析引擎与配套组件](rea-engines.md)。

### 上游核验依据

精确发行包：[rea-agents@6.7.0](https://registry.npmjs.org/rea-agents/-/rea-agents-6.7.0.tgz)、[rea-agents@6.8.0](https://registry.npmjs.org/rea-agents/-/rea-agents-6.8.0.tgz)。核验时先按官方 npm 元数据的 `dist.integrity` 校验归档，再比较解包文件，未执行包代码来推断契约。

下表 SHA-256 是发行包内文件内容摘要，不是 Ghidra ZIP 的归档摘要：

| 包内路径 | 6.7.0 SHA-256 | 6.8.0 SHA-256 |
| --- | --- | --- |
| `package.json` | `3f6c47fb12c8388f291a21e7f99a876495d03aee671b3b6a0708dd12d6ebb570` | `b0fc212f6bea9b4ee6e2b3ab0b52dd95402c229da3b8652127e5f131c3445b39` |
| `dist/ghidra/GhidraReleasePolicy.js` | `c2d63785585ba0f74501e5caa7ac3112325b98d820575139127cb4c7712384b0` | 同左 |
| `dist/ghidra/GhidraInstallationPolicy.js` | `5ad836cc82f1de96bb82689d15ac454fccc8d58c97635bddedaff7051b6865af` | 同左 |
| `dist/android/JadxRelease.js` | `5ce5156851e8d737a88c03e2f11bf7ac413ac3d8189f8285f65ad285aca176fc` | `0ea5fb79a9a88866b194244abf78d24628fa5f1b67ddd00a26e1acd921b24c60` |
| `dist/android/JadxJavaProbe.js` | `89b34158af96ad7ba3712427870531c7d425951c58e02a95beec69c1001dd087` | `e4353cc6a28bec12c126cea185f4cc57c31fd2eb290cfa7a8bb93fd5d83b7a22` |
| `third_party/wabt/README.md` | `f1fccc6e0e378ab39205a7d671f1bed7d47f51ecf79b1e9cad801fa160c2ed5b` | 同左 |

两版 doctor 均保留 `healthy`、非空 `scope_checks` 与检查项的 `name/ok/detail`；6.8.0 新增 `hopper-startup-timeout`、`runtime-configuration:<SETTING>` 等启动配置检查，进入 provider scope 的健康判定。Axiom 要求 scoped report 的全部检查通过，不能只寻找一个成功项而忽略新增失败项。

本轮契约文件比较不等于重新下载并实机验收 Ghidra/Java/商业 Hopper。Windows/Linux 的平台分支与归档映射也不等于原生实机验收。

## 验证入口

- `app/tests/component-environments.test.ts`：不污染宿主/其他语言环境、目标 engines/LTS/资产选择、完整运行时篡改检测、真实 launcher 子进程与 literal MCP 环境。
- `app/tests/component-publication.test.ts`：状态残留、旧共享 Node 的 patch 兼容性与修复入口、未知契约拒绝、发布后 fsync 故障、Ghidra 版本拼写。
- 现有 `rea*.test.ts` / `opencli*.test.ts`：离线私有 Node fixture、安装/更新回滚、取消/冲突、技能/MCP 与卸载保护。
- 现有 RTK、模型代理和 tool-process 测试：原生安装/监督/归属/清理回归。

离线 fixture 复制测试进程的真实 Node 到私有目录，仅证明绑定、执行与回滚；不能用它证明该 Node 满足真实 `rea-agents@6.8.0` 引擎要求。真实官方发行下载、npm 安装、MCP 或浏览器 doctor 的结果需单独报告。
