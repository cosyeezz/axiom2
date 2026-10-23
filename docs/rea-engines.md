# REA 分析引擎与配套组件

入口：配置 → 内置工具 → REA → 分析引擎与配套组件。

页面加载与刷新只读取配置、文件及常用路径，不安装组件、不预热。点击“检测配套组件”才运行 Java 属性／模块、WABT 版本或 REA 的无目标 doctor 检查；不会启动 GUI、打开分析目标或枚举设备。检测通过表示环境具备条件，不保证目标分析、许可或桥接成功。

## 系统选择

以 **运行 Axiom 后台的系统与 Node CPU 架构** 为准，不以浏览器、手机或远程客户端的系统为准。页面展示后台平台，路径也必须是后台电脑上的绝对路径。使用转译版 Node 时会按其架构选择组件，请保持 Node 与预期分析架构一致。

| 组件 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| JDK 21 | x64／arm64 托管下载 | x64／arm64 托管下载 | x64／arm64 托管下载 |
| Ghidra | 接入已有完整安装；官方 ZIP 缺本机 native，需自行构建 | x64 托管下载；REA 原生控制模块与本地 NTFS 限制仍适用 | x64 托管下载；arm64 接入已有完整安装，native 需自行准备 |
| Hopper | 接入已有启动程序，不验证许可 | REA 不支持 | 接入已有启动程序；检测仅确认文件，不代表发布者／显示环境通过 |
| JADX Headless MCP | x64／arm64 托管 JAR | x64 托管 JAR；arm64 不支持当前 REA 契约 | x64／arm64 托管 JAR |
| WABT | arm64 托管下载；无对应 x64 官方包 | x64 托管下载；无对应 arm64 官方包 | x64／arm64 托管下载 |

支持表表示实现的平台分支和上游发行范围，**不等同于 Windows／Linux 实机验收**。其他架构明确不支持，不静默换用另一系统或架构的包。Ghidra 仅在 Windows/Linux x64 提供官方完整包托管下载，其他支持平台只接入已有完整安装，不自动编译。Hopper 始终只接入已有安装。

## 版本与配置

当前托管安装及 Ghidra／JADX doctor 适配契约验证于 `rea-agents@6.7.0`；更新到未适配版本后不默认继续使用原安装策略。JDK 取 Adoptium 21 最新修订，Ghidra 验证 12.1.4、接受 12.1.x，JADX Headless MCP 固定 0.7.1，WABT 固定 1.0.42。普通 jadx CLI 不能代替此 JAR。

| 配置项 | 路径含义 | 注入 REA 的变量 |
| --- | --- | --- |
| Java | 完整 JDK Home，macOS 通常为 `Contents/Home` | `JAVA_HOME` |
| Ghidra | 包含 `Ghidra/application.properties` 的根目录 | `GHIDRA_INSTALL_DIR` |
| Hopper | 可执行启动程序，不是 `.app` 目录 | `HOPPER_LAUNCHER_PATH` |
| JADX | `jadx-headless-mcp` JAR 文件 | `REA_JADX_MCP_JAR` |
| WABT | 包含三个 WASM 工具的 `bin` 目录 | `REA_WABT_BIN_DIRECTORY` |

JDK 检测要求17+且有 `jdk.compiler`，推荐21；Ghidra 按自身声明的 Java 上下界验证。WABT 要求 `wasm-validate`、`wasm-objdump`、`wasm2wat` 均为1.0.42。Windows 自动使用 `.exe`，Ghidra 的 `.bat` 与 native 文件检测由上游 doctor 负责。

保存路径采用配置 revision 冲突保护；保存本身不会执行程序。清空恢复环境变量／常用路径发现，不删除原安装。配置仅注入 REA MCP 及检测子进程，不修改系统 Java、全局 PATH、其他 MCP 或终端 pi 设置，不运行 `rea setup`。已有会话须重新加载技能与 MCP。

## 托管安装与恢复

用户确认下载后，官方 HTTPS 下载经过每跳地址白名单、大小／超时限制及 SHA-256 校验。JDK 校验值来自 Adoptium 元数据，WABT 来自固定发行校验文件，JADX、Ghidra 使用固定版本哈希；校验保证与发布内容一致，不代替供应链审计。

新文件写入 `integrations/rea/engines/<组件>-<UUID>/`，保留来源元数据与归档内许可。ZIP／tar.gz 使用解析库逐项验证并自行落盘，拒绝目录穿越、Windows 保留名、特殊文件、大小写冲突及超限展开；tar 内安全的普通文件链接最后复制为文件，不创建系统链接。安装后检测通过且配置修订未改变，才原子切换路径。取消、失败或冲突清理本次准备目录，原路径保持不变；旧成功目录保留给在途会话，不自动删除用户文件。

检测子进程不使用 shell；POSIX 超时／取消终止独立进程组。Windows x64/arm64 使用独立 Node 监督进程，在启动检测程序前通过 Koffi 加入 kill-on-close Job Object；初始化失败不启动检测，监督进程退出或被强杀时终止该 Job 的普通后代进程，不依赖仍存活的父 PID。它不是安全沙箱，宿主 Job 策略可能阻止嵌套；经外部服务创建的进程不在此保证内。

操作复用 REA 单任务、取消与进度记录。关闭页面不会取消操作；重启将未完成记录标为中断，不自动续装。当前没有自动回收旧版本和强制退出残留目录的功能。

## 验证范围

专项测试覆盖平台资产映射、Windows 路径、ZIP／tar 解包与路径逃逸、SHA-256、修订冲突、取消清理、MCP 环境隔离、“刷新不探测”、Ghidra／JADX scoped doctor 报告契约，以及父先退出时的后代清理。Windows Job 初始化顺序与失败关闭有 API 替身测试；真实 Win32 API、嵌套 Job 策略和 Windows 清理行为仍需原生系统验证。浏览器专项覆盖显式检测、路径保存、安装确认和响应式布局。测试使用隔离目录和发行／检测替身，不真实安装大型引擎，也不代表商业许可、远端下载网络、实际目标分析或 Windows／Linux 原生系统闭环已经验证。
