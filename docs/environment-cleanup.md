# 卸载与安装前环境清理

状态：整体未完成，当前等待外部验证/归属与旧worker退出证明。第十一轮REA登记下载包及proof只读入口修复完成（94测试+兼容51、tsc、UI22、构建、完整独立审查通过）。第十二轮安全收紧及审查修复已完成：RTK离线仅可查看范围，缺历史worker退出证明禁止删除；原生拒绝前不调用旧CLI、不回收维护记录、不建立安装锁，状态/安装记录FIFO均非阻塞拒绝。88项回归、补丁相关15项Node（含5项实际Rust模块测试）、tsc、UI24、桌面构建、原生offline/locked及完整独立复审通过。Windows/Linux真runner仍未验证。未执行本机卸载/重启/发布，不宣称环境已干净。最新接续以“第十二轮接续”节为准。

## 用户目标

在“服务与更新”页提供逐项卸载功能，覆盖终端/应用内 Pi、MCP、其他可安装项目、独立资源及组件代码。支持安装前发现未知旧安装、原始安装目录、缓存与残留，逐步删除，清理后重新检查安装冲突。用户已澄清此前的 Hi、MSP 分别为 Pi、MCP；不能将 MCP 当作 Skills 的别名。编译进程序的默认提示保持现状，不为删除这些提示重构发布或加载方式；该项不再作为其他卸载功能的前置阻塞。

## 页面与流程

入口建议命名“卸载与环境清理”，服务与更新页和首次安装流程均可进入。只读扫描不要求后台已正常启动。先选择当前电脑及目标安装；远程连接须明确显示实际目标机器。

每个对象显示名称、版本、来源、安装目录、缓存目录、大小（无法读取时显示未知）、配置引用、运行占用、冲突依据，以及可执行的操作。没有安装记录但发现文件的对象显示“归属待核实”，不能直接收养为托管文件。

支持三种意图：

- 清理安装残留：清除已核实不再使用的失败候选、下载及解压临时文件、旧版本和失效引用，保留正在使用的安装。
- 卸载程序：删除选定程序和独占组件、旧版本、专属缓存，明确展示保留设置与数据。
- 重置组件环境：在卸载基础上选择删除该组件配置、运行数据或凭据。每项显示实际影响；共享凭据和其他资源仍引用的内容需要保留并说明原因。

每次执行采用“扫描 → 预览 → 确认 → 核实占用与身份 → 停止相关进程/解除引用 → 删除程序及选定残留 → 重新扫描”。执行前重新核对配置版本和文件身份；扫描后发生变化须重新生成预览。

每一步有明确状态和错误原因。中途失败保存已完成与待清理项，下次点击“继续清理”只处理仍属于原目标的对象；不自动重放删除。清理结果显示已删除、保留、阻塞、未验证及具体路径。存在阻塞或未验证项不能宣称环境完全干净。

## 已核实范围与缺口

| 对象 | 现有实现 | 所需处理 |
| --- | --- | --- |
| 终端 Pi | updater.mjs 检测所选 Node 对应的 npm 全局目录；无桌面卸载动作 | 区分新旧命名空间、多套 Node/npm 与实际命令来源；调用对应包管理器卸载并检查命令解析 |
| 应用内 Pi / 后台依赖 | 随后台版本发布 | 当前不能逐包物理删除而保持后台可用；随后台卸载，独立组件化需另定语义 |
| 后台服务 | 桌面托管在数据根/service，另有 npm 全局安装 | 按安装来源处理；停止并核实后台、启动注册、维护事务和恢复备份；保护用户项目与会话数据 |
| 客户端 / Node / Tailscale | 系统安装器或包管理器安装，可能共享 | 显示实际来源，由对应卸载器处理；不能仅删目录；客户端/后台自卸载需独立执行器 |
| OpenCLI | 私有版本目录；旧版保留；可接入外部安装；npm缓存未独立隔离 | 清理可证明归属且无引用的版本，展示外部安装和公共缓存；Chrome扩展另识别，不能把浏览器档案当程序缓存 |
| RTK | 卸载版本目录，保留设置、effects.sqlite、originals | 分列程序、过滤设置、统计与原文；删除统计行不等于回收数据库文件空间 |
| REA | 主包卸载不连带引擎和下载包；Skill/MCP卸载为关闭接入 | 分列主包、各引擎、手动下载包、旧版本、Skill/MCP；删除实际组件代码需拆分发布与安装方式 |
| 模型代理 | 内核、xray-knife导入组件独立；保留订阅与绑定 | 统一展示版本、导入归档、遗留运行目录；清理前核实进程身份与引用 |
| 普通技能 / MCP / Pi资源包 | 多作用范围；独立UUID安装、npm共享前缀、Git、本地源及远程连接 | 扫描实际范围和共享引用，清理独占安装及专属缓存；本地源、共享前缀不能整体删除 |
| 系统提示 / 内置技能 | Axiom默认提示编译在代码，另有运行时资源；pi-development随包发布 | 按用户批注，不处理编译内置默认提示，也不调整其发布方式；独立安装资源沿用资源卸载规则 |

## 安装空间与缓存规则

1. 安装目录、下载归档、解压候选、旧版回滚目录、运行缓存、包管理器缓存分开识别。名称含cache、tmp或旧修改时间均不足以证明可删。
2. 优先使用安装归属记录、事务记录、包身份和真实路径建立清单；软链接只处理链接自身，不追删目标。文件/目录身份变化则中止该项清理。
3. 后台安装会留下setup任务中的axiom2.tgz和runtime目录；更新使用updates及事务备份。恢复事务、未退出进程及待核实任务引用的内容先核实，不能当普通缓存清除。
4. 普通独立MCP安装已有UUID目录内的专属cache；OpenCLI等npm安装可能使用公共缓存。专属缓存可随组件清理，公共缓存须另列来源和影响，不能无差别执行npm cache clean --force。
5. 配置引用核验覆盖skills、packages、extensions、prompts、themes、MCP command/args/env、默认能力选择及相关进程；删除后检查是否回退到另一份同名资源。
6. 不因“清空路径”而假定组件消失：PATH、环境变量及系统安装来源仍可能被自动发现。扫描应说明实际生效来源与优先级。
7. 后续安装宜记录程序、缓存、候选、命令入口及依赖关系，尽量采用组件专属缓存；历史未知文件单列，不自动获得删除资格。

## 实现入口与约束

- UI：app/src/client/pages/DesktopUpdates.tsx、SetupWizard.tsx。
- 桌面桥接：app/desktop/axiom_service.rs；新脚本/命令还须同步scripts/build-desktop.mjs。
- 桌面安装与更新：app/desktop/setup-service.mjs、updater.mjs、updater-reconciliation.mjs、updater-supervision.mjs。
- 工具：app/src/server/integrations各组件及builtin-operation.ts。复用维护锁、归属核对和removalPending，但不能把现有“保留设置”卸载直接称为彻底清理。
- 普通资源：app/src/server/resources.ts、pi-package-storage.ts、capability-resources.ts。Resources.refresh含恢复写入，不可直接作为只读扫描入口。
- 提示与内置技能：app/src/server/axiom-prompt.ts、environment-resources.ts、app/skills/pi-development。
- 相关现有设计：docs/download-maintenance.md。

工作树存在大量既有未提交修改，实施应基于当前文件做局部改动并避免覆盖其他工作。尚未验证真实机器残留；不能据此宣称支持所有系统包管理器或外部工具的缓存发现。

## 当前实现与接续

- `app/desktop/axiom_environment.rs`：只检查已知程序、缓存、配置路径的元数据及 PATH 候选文件，不执行候选命令、不读取配置正文。数量上限 20,000，深度上限 48，PATH 目录上限 128，时间预算 5 秒（软限制）。`axiom_environment_fs.rs` 新增基于目录句柄的遍历：Unix 使用 openat/O_NOFOLLOW 与 fstatat，Windows 持有不共享写入/删除的祖先目录句柄并拒绝 reparse/网络路径。
- `app/desktop/axiom_service.rs`：本地授权后的 `axiom_environment` 命令由互斥监督线程调用 `axiom_environment_process.rs`，启动同一可执行程序的独立 worker；worker 在 Tauri 初始化前分流，不创建窗口或启动后台。监督器 6 秒超时请求终止子进程，IPC 等待 8 秒；输出上限 2 MiB。终止后短暂轮询退出，未确认退出时以 `Mutex<Option<Child>>` 保留进程所有权，下一次调用先核实/回收，避免新增回收线程失败或丢失子进程；等待期间拒绝新扫描。`scripts/build-desktop.mjs` 已接入三个模块、main 分流、Unix libc 依赖与命令注册。
- `app/src/client/pages/Connect.tsx`：本地服务维护折叠区增加“卸载与环境清理（安装前检查）”；`DesktopEnvironment.tsx`、共享类型及专属样式提供扫描、重扫、错误和未核实项展示。最新阶段已嵌入 `DesktopPiRemoval.tsx` 卸载入口，见下方接续记录；扫描本身仍不会删除。
- 已校正工具配置路径：RTK/REA/model-proxy 为 `integrations/<name>/config.json`，OpenCLI 为 `integrations/opencli.json`。
- 最终版 `node scripts/build-desktop.mjs --generate-only` 与 `CARGO_TARGET_DIR=/tmp/axiom-environment-native-target cargo check --offline --manifest-path artifacts/pake-template/src-tauri/Cargo.toml` 均退出 0。验证了完整 macOS 原生模板编译；唯一警告为既有 `axiom_views.rs` 的 `RENDERER_GENERATION` 未使用。
- `app` 目录执行 `./node_modules/.bin/tsc --noEmit`、`npm run build:desktop` 均退出 0；日志 `/tmp/axiom-desktop-validation.VxXO2g`。后者只是 Vite 桌面前端构建，不能当作 Rust 原生验证。
- UI fixture 与检查已完成：`app/tests/fixtures/environment-inventory.tsx`、`app/tests/environment-inventory.check.ts`。现有 Chrome 运行检查全部通过：显式扫描、防重入、部分/未知结果、错误保留旧结果、畸形响应、恢复、空结果不报干净；深浅主题 × 320/390/1200px 均无横向溢出。截图/日志在 `/tmp/axiom-environment-ui-validation`，前端再次构建退出 0。测试期间修复了扫描图标默认 300px 造成的溢出，以及 fixture 缺少 tsx `__name` helper（后者非产品问题）。
- 可重复运行的离线原生测试 `node scripts/test-environment-inventory.mjs` 最终退出 0：8 项单元测试全部通过（只读/不泄露正文、缺失根不创建、链接及祖先链接、打开后替换目录、预算与 PATH 部分结果、超时后重试、无效输出、待退出进程保留及回收）。真实 worker 在临时数据目录完成跨进程调度，检出文件数/字节数准确，不输出或改动凭据正文；临时目录已清理。首次并行 fixture 路径碰撞已通过 AtomicUsize 后缀修复。

静态审查发现的两项边界已实施修复并通过本机回归：

1. 原实现先检查祖先再按路径递归，存在目录被并发替换为链接的 TOCTOU。现改为句柄相对读取；新增测试在打开目录后替换祖先/子目录，检查仍读取原目录且拒绝新链接。Windows 对应分支尚未实际运行验证。
2. 原实现的软预算无法中断同步文件系统调用，线程会长时间占用扫描门闩。现改为独立 worker 和受限输出、超时终止及持有待回收进程；仍等待操作系统真正回收的极端情况明确拒绝新扫描，避免进程堆积，不声称任何内核故障都能被用户态立即中断。

当前验证依据：最终原生测试 task `58a1aff2-9895-44b5-a178-eac8cba39702` / result `17c5914b-6652-4cb4-a1f2-cad7f7b5bad4`，最终完整模板编译 task `e01f9cac-2670-4a92-82dd-41992b9d3866` / result `4ee40e15-1c23-4b18-bbe7-fe163fa68406` 均已读取核对；最终边界复审 task `7e401f43-37dc-4697-b0e8-7af86a4990f9` / result `1bb2f909-cbbb-4fc1-a178-df3b926c6c8c` 确认原缺陷解决、当前生产调用链未发现新增实质缺陷。必须保留桥接的全程串行化：process 模块内部的待回收槽不替代扫描并发互斥；若子进程在短轮询后退出，最多保留一个待回收子进程，后续扫描再次核实回收。

验证边界：仅安装 `aarch64-apple-darwin` target；Windows 分支、真实桌面 IPC 和安装包尚未运行验证。以上扫描验证对应新增卸载前的版本，新增卸载和监督改动须按下方接续记录继续回归。扫描不会授予任何删除资格。会话详情工具此前持续返回“详情不存在”，暂未成功创建受管详情；主记忆关联本文作为接续依据。

## 必要验证

使用隔离临时目录和模拟安装器验证：正常卸载、安装前残留清理、重复清理、中途失败恢复、配置并发变化、符号链接/目录替换、跨项目共享引用、进程未退出、损坏归属记录、同名资源回退以及共享缓存保留。界面验证扫描不会删除、分步进度与错误可见、未完成不报成功、后台未安装或故障时仍能进入清理。各平台的原生卸载器和自卸载路径需分别验证，不能以单平台测试替代。

## 下一阶段执行接续

用户最新批注明确 Hi=Pi、MSP=MCP；编译在程序中的默认提示“不用管”。这两项已落实到本方案并关闭范围确认任务，不得再次以名称或提示语义等待用户。用户随后要求维护记忆并立即继续，维护只是中间步骤。

当前阶段为逐项清理执行器实现。调查结果与最新代码见本节，不能把隔离mock测试当作产品卸载已验证。

### Pi 实现与未验证修改

- 新增 `app/desktop/pi-removal.mjs`：保守核实 npm 标准目录、包清单、唯一 pi bin、Node/npm与命令入口身份；拒绝旧命名空间、链接目录、外部shim、后台共享Pi；预览列程序/命令将删，公共缓存/用户设置保留，其他旧安装/外部终端未核实。Windows现有命令包装器暂明确拒绝，不能宣称已支持Windows卸载。
- `app/desktop/updater.mjs` 新增 `pi-remove-preview` 与 `pi-uninstall`；预览写 updates/pi-removal.json，随机token绑定文件身份；确认JSON必须 {token,confirm:true,sessionsClosed:true}；复用 `.axiom-pi-update.lock` 与已有异步worker/维护锁；锁内再次复验，消费token并使升级确认失效，执行固定 npm uninstall --global --prefix … --ignore-scripts --offline --no-audit --no-fund 包名，再lstat复核程序和shim消失。job.cleanup列明removed/remaining/retain/unverified，未宣称整体干净。
- `maintenance.mjs` 增卸载标签/steps，removing阶段禁取消；`axiom_service.rs` 增action白名单并释放pi-removal.mjs；`scripts/build-desktop.mjs` 复制新增模块。
- 新增 `DesktopPiRemoval.tsx`（嵌入DesktopEnvironment）：显式预览，范围确认与关闭终端checkbox，任务轮询、失败结果、完成后环境复扫；没有自动删除。仅确认关闭终端，不自动杀外部进程，真实占用全面核实仍有缺口。
- `app/tests/pi-removal.test.ts` 新增7项隔离mock测试。首轮验证 task e40fcdf1-3801-4330-800c-3ecd3d332aa6 / result 10ac281c-c219-4f34-bbfa-0ef689f09468 已读：`cd app && ./node_modules/.bin/tsx --test --test-concurrency=1 tests/pi-removal.test.ts tests/pi-updater.test.ts tests/desktop-supervision-history.test.ts` 退出0，26/26通过；日志 /tmp/axiom-pi-removal-tests.log。后续源码又已修改，必须重跑。
- 边界审查 task 3152efe4-5169-4388-a03a-a7f24323f982 / result 23e24cbf-3eb4-4b93-9d32-84d6790b11ce 已读。发现3项已修但未补测：(1)登记CLI是符号链接时共享依赖漏检，现同时检查字面/realpath CLI依赖路径并绑定真实CLI身份；(2)npm部分删除后失败旧版本缓存未刷新，现删除前把pi-installation.json置为待核实，安全失败后piStatus(true)；(3)卸载完成时已有扫描在途会吞掉复扫，现DesktopEnvironment.scan(afterCurrent=true)等待前扫描完成再扫，返回成功boolean，子组件只有实际成功才记录rescanned。
- 审查额外运行原更新测试：`tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/pi-removal.test.ts tests/pi-updater.test.ts tests/desktop-updater.test.ts` 44项41过3失败，均源于下述缺失载荷模块；日志 /tmp/axiom-pi-review-84lzJu/tests.log。复现共享链接/旧缓存脚本 /tmp/axiom-pi-review-84lzJu/repro.mjs（仅临时mock）。

### 监督器当前修改

调查 task 12e27a9a-a3a1-4d52-a8f8-38aead7e26b0 / result e88d6582-169b-450e-8928-fa550fc51857 已读：其他并行改动让 process-owner-record 静态导入 maintenance-process-pid，但 build-bootstrap payload漏模块，解包import失败；桌面bootstrap仍只支持Windows/Linux，服务端新Darwin PID后端没有接线；Linux首次执行总要联网下载helper。

主代理已改但尚未生成/测试：
- `scripts/build-bootstrap.mjs` 转译列表加入 server/maintenance-process-pid，修复载荷闭包。
- `bootstrap/main.mjs` 导入 forkPidProcess，runOwnedCommand允许Darwin，supervise增加Darwin分支。worker用 owner-control.json nonce/GO屏障等待原生PID归属持久化后才执行；Darwin worker监听IPC disconnect与100ms独立期限检查，停止自身进程组；主host仍跟踪子孙、核实退出。主loop对Darwin持续刷新owner-control截止时间。
- **这些监督改动未测试、未审查，不能认为完成。** forkPidProcess源来自并行任务，为best-effort进程组+观察到子孙，不能声称与Linux命名空间同样隔离；瞬间完全脱离的daemon不在保证内。需测试先登记后GO、父退出/期限、普通命令、无残留、未知退出保护。`createUpdaterSupervisor.start`后台启动仍拒绝Darwin，Pi命令无需此入口；不要顺手放宽服务启动。
- **下一步必须先 `node scripts/build-bootstrap.mjs` 更新 setup-runtime.json/install.ps1/install.sh，再解包import并测试真实监督（只用无害命令/临时npm fixture）**。生成文件已是其他任务未提交改动，应以当前源码生成、避免回滚别的内容。
- Linux离线helper尚未实现：可从核实的当前Axiom安装根复制配套bin/native/linux-${arch}/axiom-owner+manifest，验证普通文件/摘要/架构/可信来源；不能信PATH或随意缓存。当前卸载npm虽有--offline，监督器可能联网，不能声称全链路离线。macOS本机为arm64，Windows/Linux真实验证未具备。

### 后续工作顺序

1. 补3项审查回归测试，生成并验证监督payload；测试Darwin GO/退出/期限。重跑Pi与desktop-updater回归，修正失败。
2. 验证Pi UI（现有 environment-inventory.check.ts 仍应不自动调用任何IPC；新增卸载动作需要扩展fixture测试确认/防重复/未知/复扫排队），tsc/Vite构建和完整原生模板cargo check。
3. 实现MCP/工具桌面白名单桥接与统一结果面板。当前只完成调查，**没有创建该桥接脚本或UI代码**。不能只提供链接就认为用户需求达成。
4. 实现托管后台卸载、自卸载恢复journal、安装前残留清理/资源配置处理；不能删除整个共享prefix。独立资源/MCP卸载须保留revision/维护屏障/共享引用保护。
5. 全部目标仍在进行中，不因记忆或压缩停止。用户未授权真实本机卸载，测试必须隔离。

两个前期只读调查结果：

- MCP/工具接线 task `a4892586-0587-4107-912e-ade27d14298d` / result `674c6185-daaa-4dc1-be21-268b8b29ccee` 已读取。后台已有资源与工具卸载 API，但桌面控制页不能直接复用 WebSocket transport（固定 location.origin，后台校验精确 Host/Origin）。建议本地原生白名单桥接；不放宽 CORS、不开放任意 URL/命令。普通 MCP 用 `resources.get`→`resources.remove`，内置 MCP 走所属工具；OpenCLI/RTK/REA/代理有带 revision/confirm 的卸载。多数为异步任务，必须等待终态并复读，检查 removalPending；配置保留不能称为彻底清理。后台不可用时没有现成安全离线卸载 API，需要独立维护宿主，不能用 Rust 扫描结果直接删除。完整出处见这些模块当前源码。
- Pi/后台 task `c80ef108-6321-4221-be3e-682ce4fcc0f9` / result `99852226-30cb-441c-bf14-28ee515b79b4` 已读：无现成卸载动作，可复用维护锁/服务stop+reserveService协议；后台必须严格位于root/service并核实真实路径，停服确认+启动预约后隔离程序，登记按内容匹配移除，需专用卸载journal，不能套用升级恢复journal；保留用户数据。其27项现有回归通过，仅为既有机制验证。

工具协议补充调查 task e9c8c302-ed70-472a-9013-832b1d444fad / result 1cfe9615-2e7e-4080-9ef7-883fa94d1957 已读：WebSocket发送 {requestId,op,params}，receipt {type:'receipt',requestId,ok,data|error}。get返回revision字符串，确认后原样提交，不自动更新revision重试。普通resources.remove {id,revision,confirm:true}可选clearCredentials需单独授权，不默认force；用acceptedJobId跟踪jobs，终态无error且原id消失。REA主/引擎用rea.get + uninstall/engine-uninstall {engine,revision,confirm:true}，引擎java/ghidra/jadx/wabt托管可删、hopper外部拒绝，按jobs中确切job.id跟踪（不可跟兼容job）；引擎消失判断!managed&&!removalPending，外部path可仍存在。REA Skill/MCP uninstallSkill/uninstallMcp只是关接入。RTK/OpenCLI按get→uninstall {revision,confirm:true}；RTK无version/executable，OpenCLI configured=false（外部安装保留）。代理内核modelProxy.uninstall {kernel:xray|mihomo,revision,confirm:true}，终态job.id===requestId、!running、无error且installations[kernel]无、removalPending无；importerUninstall没有独立job，核实importer busy=false、filesPresent=false、removalPending=false、无error。scope订阅可用resources、builtin-tools:rea/rtk/opencli/model-proxy。get/卸载桥接不能开放任意URL/命令、放宽CORS。可由Rust只取run(status)给出的受控本机URL，再Node从登记CLI的依赖createRequire加载ws（是否可用尚需核实），固定白名单参数。相关类型 resources.ts/rea.ts/rea-engines.ts/rtk.ts/model-proxy.ts；OpenCLI类型在shared/builtin-tools.ts，非opencli.ts。

当前核实的 Pi 入口：`app/desktop/updater.mjs` 的 `piEnvironment` 使用 Node 对应 npm root --global，识别 `@earendil-works/pi-coding-agent` 与旧 `@mariozechner/pi-coding-agent`；有 prefix/程序身份快照。`perform(kind,version)` 的 pi 分支（约551行）已有跨数据根的 `.axiom-pi-update.lock` 原子硬链接锁、监管器 bindPiLock、检查后复核、npm --ignore-scripts、运行验证。`runJob`/`start`/CLI dispatch 维护异步事务；`axiom_service.rs` 白名单和 `DesktopUpdates.tsx` 对应 UI 需同步扩展。设计现已采用上述预览+身份绑定与共享锁内卸载；公共缓存与用户配置保留。仍须继续处理旧命名空间、Windows包装器、外部占用与残留归属等未覆盖范围，不能将保守拒绝当作所有项目清理完成。

工作树仍有大量别的未提交改动，`resources.ts`、各工具模块尤其在被其他任务改动。主代理仅局部编辑，子代理仅调查/验证，不写代码；不要为本任务覆盖无关内容。无需加载浏览器技能（已有本地Playwright测试）；当前未执行任何本机卸载或重启。

## 本轮最新接续

本节覆盖上方阶段记录中过期的“未生成”“未测试”“无工具桥接”结论。用户再次要求压缩前维护记忆并立刻继续；当前没有任务停止或卸载本机授权。

### 监督修复与验证

- 已运行 `node scripts/build-bootstrap.mjs`，更新 setup-runtime.json、install.ps1、install.sh；载荷含 maintenance-process-pid。`execute(process.execPath,['-e',...])`真实无害命令成功。
- 新增 `app/tests/bootstrap-darwin.test.ts`。最初5项通过，但完整组合 task 3258781d-f0fe-4318-b9a4-272b6a2a6e8d / result 804dd36d-859c-4167-94ae-4630fb1ef4de（已读）52项51过1失败：100ms期限worker先杀组导致缺result并丢total-timeout。已在bootstrap/main.mjs写worker-stop.json nonce/reason，仅在native.close证明退出后映射deadlineError；修复后desktop-updater+Darwin28/28通过，日志 /tmp/axiom-darwin-final.log。
- 审查 task 0fefd035-9d6f-4b54-8049-b21ac4d25c91 / result b0de1d3b-df08-4f44-9dfd-a0e7f02ab0c1（已读）指出已登记的setsid脱组成员在host死亡后会存活。已修：owner.arm之后镜像nonce/identity到pid-members.json，再允许GO；worker停止前比对自身身份和每个成员PID/started，补观察成员后代，杀已知成员后再杀自身组。未扩大到按进程名杀进程。
- Darwin测试增短100ms期限、等待detached后代登记后杀测试host，共7项。原长期限断言已改code===total-timeout。复核 task 84b593b7-9d52-4394-87f9-1bc0adba4b8a / result e94742de-fa00-4d9d-972a-b4b5680cca57（已读）：7/7退出0，日志 /tmp/axiom-darwin-members-review.log，确认载荷main一致、无新增实质缺陷。仍是PID/ps best-effort，秒级started与kill之间竞态、采样间完全脱离不保证；不是内核隔离。
- tsc首次通过；后续再次执行只报其他并行修改 `app/src/server/models/draft.ts:141,144` unknown不能赋给string|number/unknown r.value。尚未修改该文件，也未把当前全局类型检查标成功。

### 工具卸载已写代码及待修

- 新增 `app/desktop/tool-cleanup.mjs`：Node原生WebSocket，无需ws依赖；限制 `http://127.0.0.1:port/`无用户信息/query/hash；固定resources/rea/rtk/opencli/modelProxy get/remove白名单，校验revision/confirm/engine/kernel；不允许force或任意URL/命令；读取receipt匹配requestId，20s超时不重放。返回 {requestId,data}。凭据只有clearCredentials显式true。
- `axiom_service.rs` 新增 `axiom_cleanup(window,request)`：授权Webview→ensure_idle→CONTROL锁→run(status)取得当前登记本机后台URL→释放内置helper到updates→经stdin传<=16KiB JSON→25s/8MiB有界读取。后台未运行时明确报错但扫描/Pi入口继续可用。scripts/build-desktop.mjs已复制helper并注册命令。仍需原生模板生成/cargo验证。
- 新增 `desktop-cleanup.ts`：规范化资源/REA主包/引擎/Skill与MCP接入/RTK/OpenCLI/代理内核与importer行；展示删除和保留，按受理job核验终态和removalPending。REA严格从jobs[]找对应id；resources acceptedJobId。外部/内置来源禁止直接资源删除。importer当前实现有下述缺陷。
- 新增 `DesktopToolCleanup.tsx`：显式读取五类状态→逐项重新读revision→范围预览→凭据独立checkbox→确认一次提交→sessionStorage保存pending→轮询get/复扫。timeout保持unknown无自动重放；断线后可重新核实。已嵌入DesktopEnvironment，css添加响应式行。
- 新增 `app/tests/desktop-tool-cleanup.test.ts`，5/5通过（真实临时WebSocket服务+纯内存状态），日志 /tmp/axiom-tool-cleanup-test.log。task 51bdc3c1-2404-4507-9267-7ddf515bcc21 / result 2f011f5d-4bd7-4319-baf0-a6d68495d5e0已读，释放测试冻结。
- **审查待修1**：importerUninstall实际异步，model-proxy.ts importerCommand有runMaintenance id=c.requestId，但snapshot未公开job；desktop-cleanup.ts误归synchronous，仅文件消失即可verified。应通过维护记录或新增importer job字段取得匹配终态，否则unknown；不能只改测试放过。后台相关文件有他人修改，局部改。
- **审查待修2**：DesktopToolCleanup.verify在accepted=false时保存unknown后直接return，按钮名“重新核实与扫描”却从不onRescan；应保持unknown但仍独立环境复扫，不重放。
- UI真实交互/桌面IPC尚未验证。旧环境UI fixture只提供扫描，需要扩展确认/无自动请求/未知/复扫排队等；不要实际调用真实卸载。

### 托管后台初稿

刚新增 `app/desktop/service-removal.mjs`，**未接线、未测试、未审查**。导出inspectServiceRemoval(root)、removeManagedService({root,preview,stop,reserve,release,progress})、verifyServiceRemoval。仅允许root/service/node_modules/@cosyeezz/axiom2标准真实路径；绑定目录inode、manifest、CLI、Node、registration；只删后台包（含应用内Pi）、确认归属的.bin/axiom2链接、installation.json，不整删service前缀，不删会话/项目/工具。

设计：预览；独立journal updates/service-removal-journal.json记录prepared/quarantined/complete；stopService确认退出→reserveService启动预约→再次identity核验→rename为service/.axiom2-remove-<id>→移除命令入口/匹配登记→rm隔离目录→复查→release预约。中断后显式重新预览和确认可续清理，遇新安装/登记变化拒绝。现使用rename普通JSON，未宣称断电耐久。Windows非链接npm包装器仍拒绝，外部安装不删。旧版本/安装归档尚列unverified，仍需残留清理实现。

**初稿待核查**：resume plan可能含旧identity/额外token属性应剥离；rename后登记CLI不存在但stop跳过须依赖reserve核实control；检查目录身份与rm之间竞态；注册文件为链接时恢复分支也必须拒绝。目前updater.mjs完全未import service-removal，也未增service-remove-preview/service-uninstall动作；UI仍无后台卸载按钮。

### 立即继续顺序

1. 先修工具审查2项，扩展对应回归；必要时接只读maintenance.get来按requestId核实importer终态，仍限本机白名单。
2. 接线托管后台预览/单次确认/异步卸载：updater status、perform、claim/action、CLI dispatch、maintenance标签steps、Rust include与动作白名单（后台动作受CONTROL保护并discard视图）、build复制、独立UI。特别注意已删registration后Rust应runtime_node回退，start不能强制installation()才允许继续残留清理；journal不应自动执行删除。
3. 写隔离后台停止失败/启动竞态/登记变化/部分删除恢复/数据保留测试，补Pi真实CLI软链接共享依赖与npm删包后失败缓存回归。
4. Linux离线helper本地供应仍未实现；当前监督在Linux可能联网下载。Windows本机无target/运行环境。
5. 前端构建/类型/原生生成与cargo check、fixture交互验证。工具当前后台不健康时无法清理，独立维护宿主/全部残留清理仍缺，不能认为全目标完成。

memory_detail本轮再次尝试仍报“详情不存在”；无受管详情写入成功。以上文档为当前接续事实，主MEMORY保留任务树和文档链接。不要因记忆或压缩结束工作。

## 第二轮接续（后台接线后）

本节是最新事实，覆盖“本轮最新接续”中后台未接线、工具审查待修、draft类型报错等过期描述。用户刚再次要求压缩前维护记忆，维护后立即继续，不能只更新记忆后结束。仍无真实本机卸载授权。

### 新实现与修复

- 工具审查两项已修：`tool-cleanup.mjs`与Rust白名单增加只读`maintenance.get`；`desktop-cleanup.ts` importer acceptedJobId=requestId，progress要求history中同id/backend/proxy:xray-knife/uninstall任务，succeeded且无error，再核filesPresent/removalPending/busy；unknown/interrupted/缺历史均不称成功。无需修改后台model-proxy。`DesktopToolCleanup.verify`响应丢失accepted=false仍unknown但不早return，继续独立复扫；history读取失败同样unknown+复扫。
- 重写`service-removal.mjs`初稿：严格journal字段白名单，只存format/root/id/phase/parentsHash/packageIdentity/originalHash/registrationHash/version；所有删除/核验路径从root推导；检查root/service/node_modules/@cosyeezz/updates/.bin普通目录，目录身份不包含mtime/size；检查CLI bin父链、包清单及Node不在待删包内。journal保存fsync文件+目录。prepared→隔离rename→quarantined→删固定shim与匹配登记→核inode删除隔离目录→verify→complete。每次破坏操作前复核parentsHash。恢复原包存在时严格livePackage.originalHash，原包不存在不执行journal传来的程序，继续前仍reserveService核活进程。Windows明确拒绝，不删除共享service前缀。
- 新增`service-admission.mjs`：root/service-maintenance.sqlite，打开普通非链接文件后保持`BEGIN IMMEDIATE`连接，整个维护期间排他，进程死自动释放。setup-service.mjs在任何安装前取得并检查serviceRemovalPending；updater.runJob对service/recover/service-remove-preview/service-uninstall共用锁；未完成卸载阻止普通安装、更新与恢复；setup/service-owner.json未解除时拒绝卸载。
- updater.mjs增加serviceRemovalFile、status.serviceRemoval/serviceRemovalPending、两动作、单次token，核身份后消费，再stopService/reserveService/removeManagedService/releaseService，catch尽可能记录cleanup但保留主错误；start不强依赖installation以允许登记已删时恢复；正常CLI派发与维护任务label接线。
- 原生`axiom_service.rs`：include service-removal/service-admission；新增action白名单；service-uninstall受CONTROL锁并discard managed视图。`axiom_setup.rs`安装脚本资源释放增加service-removal/service-admission/pi-removal依赖。build-desktop复制上述模块。已运行build-bootstrap（维护label变更更新载荷）和build-desktop --generate-only，原生模板在artifacts/pake-template。
- 新增`DesktopServiceRemoval.tsx`：预览、范围清单、保存工作/停服勾选、一次确认、轮询、恢复残留提示、清理后复扫。DesktopEnvironment顺序Pi→工具→后台→扫描。后台入口不依赖HTTP健康，但损坏安装身份/原CLI无法核实仍保守拒绝。
- 新增`app/tests/service-removal.test.ts`9项，临时fixture+注入command覆盖token消耗、stop失败、竞争启动、manifest改变、.bin/updates符号链接、quarantine后故障恢复、journal任意字段/原文件变化拒绝、共享锁。
- 扩展`environment-inventory.check.ts`：所有新增交互均内存bridge，测试工具预览不删除、响应丢失不重放、已有scan时排队复扫、后台checkbox确认+双击只一次+结果复扫。fixture仍mount零IPC。

### 最新验证结果（已收并读）

- 核心50/50通过：task910e5f61-2e2b-4c20-b7c6-4f97bda8eb93 / result8a378aa8-219f-47bc-a6ed-442975960982，命令`cd app && ./node_modules/.bin/tsx --test tests/service-removal.test.ts tests/pi-removal.test.ts tests/desktop-updater.test.ts tests/setup-service.test.ts tests/desktop-tool-cleanup.test.ts`，退出0，约60秒，日志/tmp/axiom-service-cleanup-tests.log。desktop-setup.test不存在，对应setup-service.test。
- 类型+Vite：taskfbff9c7f-c214-4fd0-ab76-c45976a962e3 / result52c52626-7a09-411f-90ca-31d7532f97dc，`tsc --noEmit`与`vite build`均0，draft.ts并行错误已不复现且本代理未修改它；日志/tmp/axiom-cleanup-types.log和/tmp/axiom-cleanup-vite.log，Vite仅大chunk警告，生成app/dist/client。
- Chrome UI：taskb11b8933-09c9-4f70-a491-058ee0d48e4e / result41c28cde-236a-4274-9a7e-5426fbbbc312，退出0。命令在app下`AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' AXIOM_TEST_ARTIFACTS=/tmp/axiom-cleanup-ui-artifacts ./node_modules/.bin/tsx tests/environment-inventory.check.ts`。日志/tmp/axiom-cleanup-ui.log；深浅主题320/390/1200截图，均无横溢；新增卸载断言全过，pageerror为空。截图是扫描展开状态，未人工看图。
- 后台审查：初稿task693729ca-7ffd-4c05-8702-28fcd3d5c1ca/resulteb1921c5-7afd-4aac-ae67-e6b17c687f22指出journal任意路径、.bin/updates链接、安装互斥等；以上已修。最终复核task39ffea0e-2795-4d7e-88d4-b3249e40eadc/result96cf0720-22dc-4ffe-bc77-48433bc0f842已读，无可确认必须修缺陷，仅Windows拒绝、损坏安装安全拒绝及真实卸载未测。该任务之前失败一次（配置变化未发起请求），append一次缺上下文，最终完整重派成功，不要拿中间结果当审查。

### 当前并行任务及继续方向

**唯一待收任务**：原生cargo检查task`d0c31dc9-b03b-45f2-8c31-70a8e2819a9c`，目录artifacts/pake-template/src-tauri，命令cargo check --offline，日志/tmp/axiom-cleanup-cargo.log。收到通知后read_result，不轮询。模板文件冻结至完成。其余测试和审查冻结均已释放。

下一步仍须推进原目标，不能把“已支持三类”当全完成：
1. Linux离线helper供应：`updater-supervision.mjs command()`每个supervisor第一次Linux命令仍调用`owned.downloadLinuxHelper`联网。`bootstrap/main.mjs:181`从latest下载，验证ELF架构+release digest，写runtime/bin/native/linux-<arch>/axiom-owner及manifest.json。需要清理操作本地已验证helper供应，不能因删除先联网；可选已安装后台bin/native或桌面构建内置资源，缺失须明确阻塞而非暗中联网。当前尚未改代码。`scripts/build-native.mjs`负责构建包内bin/native/linux-<arch>（本机Mac无Linux产物）。`loadUpdaterRuntime`仅展开text setup-runtime.json。
2. 全组件/未知旧安装/下载包/缓存/残留仍缺可安全执行覆盖。工具桥接当前必须后台running（UI明确提示），安装失败时只有扫描/Pi/后台清理入口可独立用；独立离线维护宿主尚未实现，不能宣称安装前全部清理完成。
3. Windows卸载目前Pi和后台都明确拒绝shim，尚需归属校验实现与Windows实际验证；没有Windows运行环境，不能标通过。
4. 旧版本归档/更新备份/安装临时内容现在仍unverified，不整删共享前缀/公共npm缓存。按身份+确认逐项清理设计继续，禁止以扫描直接授权rm。
5. 如修改已测文件，重跑受影响检查；不要无必要重复所有测试。用户无需批准开发步骤，只禁止真实本机删除。

本轮memory_detail仍返回“详情不存在”，无详情保存成功；主MEMORY+本文件是接续依据。

## 第三轮接续（离线监督与归档清理）

本节覆盖前节待收状态。用户最新再次要求压缩前维护记忆，维护后继续工作，不能只记录后结束。原目标/授权不变，不真实卸载本机。MEMORY.md一级标题已修复成带进行中状态；详情工具仍失败，本文是接续依据。

### 收到的验证及调查

- 原生模板上轮cargo已通过：task d0c31dc9-b03b-45f2-8c31-70a8e2819a9c / result085313a3-d896-4a44-8bd7-0e4dfb9a4f08，cargo check --offline退出0，48.06秒，仅axiom_views.rs既有RENDERER_GENERATION dead_code警告，日志/tmp/axiom-cleanup-cargo.log。**本轮Rust又修改，须重新生成检查。**
- Linux调查 taskf2c0e53c-b8cd-4475-86b7-2ac84c5420f8 / resultf77c9c96-cc6a-422c-8906-ada8c958aa14已读：desktop当前仅Windows/macOS发布流水线，Linux后台helper有双架构CI；现有bootstrap下载只在首次command。建议独立桌面base64载荷，检查hash/ELF/架构/大小/父链。当前实现只内置供应，无已安装后台fallback，不依赖待删包；不能宣称Linux发行已交付。
- 离线首轮测试 task01ac5f22-8de7-4087-a8d3-00fc40fa58a4 / resultf1f0f89c-e06f-43a2-8cca-fd7c199faa41已读：app下tsx --test tests/desktop-native.test.ts tests/desktop-updater.test.ts tests/pi-removal.test.ts tests/service-removal.test.ts，41/41，退出0，日志/tmp/axiom-offline-helper-tests.log。4 native、21 updater、7 pi、9 service。**后续prepare/Rust/updater归档接线又改，需受影响回归。**
- 离线审查 taske2fe5a14-afa4-475d-b18e-86a304232497 / result93819f54-b2b9-4385-beb9-8f02014e611b已读：P1 helper校验过晚，已隔离服务恢复不跑command可跳过；P1 Rust fs::write跟随既有链接覆盖，JS拒绝已晚。两项代码刚修但未测，见下文。Linux桌面发布CI无任务仍是未交付边界。
- 残留调查 task28f15d89-6c1f-4569-bf75-a49751f1aad0首次因服务退出cancelled，无报告；append重派 result579cd144-27c9-4b56-a557-ad0002c4d9f7已读。最小范围为updates/<sha256>-axiom2.tgz，setup/<id>/axiom2.tgz需任务owner.lock+registry和终态核实；stage在transaction前就创建，没journal不等于可删；runtime含监督凭据不能删；旧式setup/axiom2.tgz无关联；MSI可能供系统安装器独立使用，排除。已选择先做更新下载归档，不以此冒称全部残留完成。

### 本轮新增与修改（当前源码事实）

1. `app/desktop/desktop-native.mjs`新：validateLinuxHelper检查canonical base64、8MiB上限、ELF64 little endian、x64/arm64 machine和sha；stageBundledLinuxHelper检查普通父目录、O_NOFOLLOW+fstat单链接读取JSON，在私有runtime中O_EXCL创建helper+manifest并fsync；prepareLinuxHelper内置缺失时offline直接失败，非offline才调用旧下载。`app/desktop/native-helper.json`为Mac/Win空占位协议1。4项fixture在desktop-native.test.ts，未运行Linux二进制，仅合成ELF字节。
2. `updater-supervision.mjs`引入上述模块，createUpdaterSupervisor多offline参数；command优先内置，不适用才在线。**审查后prepare()在loadUpdaterRuntime后、owner创建前，Linux offline直接供应helper并helperReady=true**，覆盖不执行命令的卸载恢复。`updater.mjs`四卸载/预览kind传offline=true。
3. `scripts/build-desktop.mjs`复制desktop-native/native-helper；Linux生成阶段要求先运行build-native，验证bin/native当前arch普通目录/文件、manifest.sourceSha256与native/axiom-owner.c一致、helper摘要和ELF，再在模板写base64 JSON；不会运行时编译/下载。已运行过一次Mac generate-only，但在Rust安全释放及归档新修改之前。
4. **新`app/desktop/axiom_bundled.rs`尚未编译测试**：publish(base,[(name,source)])用DefaultHasher选择内容不可变目录desktop-runtime-<hash>（hash只命名，内容逐字节确认）。Unix从/逐级mkdirat/openat(O_DIRECTORY|O_NOFOLLOW)，文件O_EXCL创建；已有文件O_NOFOLLOW|O_NONBLOCK读并验证单链接/大小/内容，不覆写。Windows持有父目录不共享写删句柄、拒绝reparse，文件create_new；已有只读对比，不覆写。自带Unix测试：重复发布、符号链接/硬链接目标不被覆写、链接父目录拒绝。`axiom_service.rs run_updater`改所有内置JS/JSON用publish（含入口改成runtime/updater.mjs），tool-cleanup也用publish；scripts/build-desktop复制此Rust并在lib.rs注册。已改`scripts/test-environment-inventory.mjs`将axiom_bundled纳入隔离Rust harness（预计多1项测试），尚未跑。
5. **新`app/desktop/archive-cleanup.mjs`尚未测试审查**：仅枚举updates内严格64hex-axiom2.tgz，最多1000目录项、单文件128MiB、总hash预算512MiB；普通单链接、O_NOFOLLOW fd读取摘要及前后stat一致，filename摘要匹配才targets。父链dev/ino绑定；transaction.json或setup/service-owner存在则拒绝。预览items含remove/unverified和其他残留retain。removeArchive(root,preview,id)只白名单id、目标在预览，固定路径从root推导，复验父链/内容/stat，再unlink单文件（不递归），返回removed/remaining和保留项。Node路径复核仍非unlinkat原子防父链竞态，审查需关注；不声称内核级隔离。
6. `updater.mjs`已接archive-preview/archive-remove：archive-cleanup.json存一次token预览，确认{token,id,confirm:true}，先消费token，removeArchive+writeJob cleanup+复查。归档动作取serviceAdmission，检查service-owner、serviceRemovalPending、history所有其他任务的running/cancelling/unknown/interrupted或history.error均阻断；不创建supervisor（无命令/网络），共用jobs claim。status对归档kind允许installation损坏并返回installationError、pi=null；其他kind保持原错误。Rust run_updater在archive动作或status且安装登记坏时用runtime_node回退；axiom_update白名单与资源include加archive两动作/模块，build-desktop复制模块。maintenance增加归档label和preview checking、claim归档remove为uninstall。
7. **新`DesktopArchiveCleanup.tsx`并嵌入DesktopEnvironment（Pi/Tool/Service/Archive顺序）**：显式预览，每项按钮+确认，展示保留范围；防双击、轮询、终态复扫、响应丢失不重放且独立复扫。无后台健康依赖。仅归档，不称环境干净。**UI fixture尚未扩展归档用例；现有测试源码已读，下一步加fixture分支/交互断言。**
8. **新`app/tests/archive-cleanup.test.ts`7项未跑**：真实临时文件+生产updater（无后台/命令），成功与token消耗、确认与路径边界、文件改变、摘要不一致、恢复/安装归属/共享锁阻断、登记损坏仍可清理、链接父链/文件拒绝。注意fixture创建others用mkdir(join(path,'..'))，可核对路径逻辑。

### 当前待办与冻结状态

无在途委派任务，前述结果均已读取，源文件冻结均释放。下一步：
1. 扩展environment-inventory.check.ts的内存axiom_update fixture支持archive-preview/remove，增加逐项确认、防双击、复扫以及不报全部干净；当前文件约150行，最后后台测试后插入归档测试。
2. 运行build-bootstrap（maintenance变更须更新setup-runtime.json/install.sh/install.ps1）和build-desktop --generate-only（新Rust模块/资源），再委派：Node archive+native+updater/pi/service回归；Chrome UI+tsc/Vite；隔离Rust test-environment-inventory.mjs+模板cargo check。测试期间不改覆盖文件。
3. 委派只读审查归档删除/锁/终态与原生资源释放两修；如发现P0/P1修后重测。
4. Linux真实内核/Windows无运行环境，保留验证边界；Linux桌面CI尚未建立，不要顺带无授权发布。所有本机真实卸载均未执行。
5. 原目标仍剩旧版本/临时残留与安装任务归档、未知旧安装归属、离线工具维护（当前工具必须后台running）、Windows包装器、系统安装项等；不得把归档和三类卸载当全部完成。已授权开发继续，不因记忆维护停工。

## 第四轮接续（归档审查修复，验证未完成）

用户再次要求压缩前整理记忆，维护后继续；目标授权未改变，不真实卸载本机。本轮所有子任务结果均已读取，**无在途任务，源码冻结已释放**。详情工具仍返回“详情不存在”，本节为最新接续依据，第三轮的“待收”状态已由本节覆盖。

### 已通过且已收取的本轮验证

- task 8b451a6a-e9d2-4ada-8a95-ae844213813b / result d4cba2b4-5030-4324-8f7b-fa6e51f1c4af：Node 61/61（archive7/native4/updater21/pi7/service9/tool5/setup8），退出0，/tmp/axiom-cleanup-round3-node.log。**此后归档/updater新增安全修复，受影响检查必须重跑。**
- task 9d63b667-4b1d-4497-8fda-aecf36b017ab / result e4133cf1-07fb-49d5-8155-da1fb61568a1：tsc/Vite/Chrome UI全部0，14组UI场景（已补归档确认/双击/复扫）；日志/tmp/axiom-cleanup-round3-{types,vite,ui}.log，截图/tmp/axiom-cleanup-round3-ui。前端源码此后未改，UI无需无理由重复；新测试TS需tsc。
- task719abada-6df0-43e9-9056-141b179a9db4 / result707dc6af-d33f-4136-893f-b1e29af872cb：inventory原生9项+隔离worker扫描通过；模板cargo check --offline退出0。日志/tmp/axiom-cleanup-round3-native-tests.log、-cargo.log。**新Rust归档模块需重生成模板重编译。**
- taskd6f51d60-47e6-41e2-ba62-1deb03d9601f / result29d9c1d7-8775-44a3-9be6-597914fe99c4：离线prepare提前和Rust安全publish两项修复确认；native+Darwin11/11和独立Rust1/1。日志/private/tmp/axiom-bundle-audit.TmEy7r。残余P2：axiom_bundled在最终文件直接创建后写，崩溃可能留下部分内容导致同hash目录后续持续拒绝，未修；非默认祖先链接数据根被拒绝；Linux真实执行未验证。

### Linux桌面工作流

- taskdc09872a-b0df-4398-a3a9-a43b01c88e00初次调查 resulte616ebfd-b3f8-4d80-8bd5-5b7103eab19a：Pake3.16.2支持Linux本机x64/arm64，--targets是包格式deb，不是CPU。
- 主代理已改`.github/workflows/desktop.yml`：platform增加linux；原desktop job在linux时跳过；新linux-desktop矩阵ubuntu-22.04 x64/ubuntu-24.04-arm arm64，安装GTK/WebKit等依赖，npm ci根prepare先构建helper；运行owner和清理隔离测试，build:desktop+build-desktop --targets deb；检查deb版本/架构、ELF machine、native-helper JSON；上传Axiom2.deb、Axiom2-binary、SHA256SUMS-linux，各架构独立artifact，无发布。
- 追加审查 result5b9e5fca-35a6-47e4-85a0-652c4ab1dd50：YAML1.2解析、8个bash run块语法、diff check全部0；唯一必修是cd app后应使用../node_modules/.bin/tsx（根npm ci不会安装app/node_modules），**已修**。未运行LinuxCI，不能宣称实际支持通过。新archive测试fixture cargo --offline在干净runner缓存可能未就绪，下一步需核对CI顺序/预取依赖。

### 归档审查发现与当前修复（最新源码未完整验证）

审查task6c15ff85-3305-4c62-8eb7-ad4602d07e22 / result482d4f85-f858-455b-be12-a510ecc296c0：临时fixture确定复现3项P1：①lstat后换FIFO使open阻塞；②最终lstat后换文件被unlink误删；③无supervisor的archive中断后，reconcile要求不存在task.json，历史interrupted永久阻断。另取消preview仍发token、removing阶段关闭预算使超时仍删。证据/tmp/axiom-archive-review.JZTH1N/{repro,control-repro}.mjs及.log。现7项原测试没覆盖这些，不能以通过代替修复。

主代理已实施：
1. **新`app/desktop/axiom_archive.rs`**：客户端自身`--axiom-archive-worker <JSON>`无GUI执行入口（请求≤32KiB），Unix逐级openat目录句柄、拒绝链接、NONBLOCK；持updates/archive-commit.lock单链接flock LOCK_EX|NB。op=remove核对updates dev/ino、transaction/service-owner、文件白名单及SHA256/身份；创建0700的archive-quarantine-<taskUUID>，renameat隔离到archive.tgz，重新打开隔离文件核对dev/ino/size和hash后unlinkat；目录句柄固定，父路径替换不能导向外部。不符就保留隔离文件并报路径。op=inspect只取内核锁，证明旧commit writer退出，返回是否隔离目录保留。Windows显式拒绝，仍未提供验证过的安全删除。
   - 使用sha2=0.10.9，serde_json/libc；新增3项Rust单测：最后一刻替换文件保留、父目录换链接不删外部、提交锁阻断reconcile，均通过。
   - `scripts/build-desktop.mjs`已复制/声明axiom_archive、导出worker，main先dispatch archive再inventory，Cargo加sha2。
   - `axiom_service.rs`run_updater设置AXIOM_DESKTOP_EXECUTABLE=current_exe；损坏登记时archive/status/reconcile/history都可回退runtime_node。
2. `archive-cleanup.mjs`：open加NONBLOCK；扫描/读取接受signal并逐块检查；preview包含updates目录dev/ino；隔离目录展示unverified；删除复核先checking（可取消/预算），checkpoint tick后才removing；调用archiveWorker以spawnSync执行内置二进制（30s SIGKILL/32KiB输出，异常标stop-unconfirmed），不再JS unlink。worker接收root/taskId/target/directory。核心提交只在临时fixture执行。
3. `updater.mjs`：preview绑定taskId，完成前tick/abort；失败/取消finally清空token；remove检查原preview对应history任务必须succeeded，传signal/checkpoint/native executable。claim阻止覆盖运行中但PID已死的archive任务，须先核实。**新reconcileArchive**在普通reconciler前处理：查当前或历史指定id、持serviceAdmission、原parent不能仍running且alive、不能有updater owner；remove调用原生inspect确认commit锁无writer；使token失效、复查原路径；结果标failed+reconciliation complete，明确未确认删除成功；历史与当前按token更新，允许下一次预览。未调用普通监督记录，不重放删除。
4. **新测试fixture`app/tests/fixtures/archive-worker.ts`**：非Windows在独立tmp目录生成Cargo工程引用生产Rust文件，cargo test/build --offline后导出binary路径；after删除。archive-cleanup.test.ts createUpdater env传binary；新增FIFO、取消preview、预算、模拟中断preview/commit恢复。Windows跳过两个成功删除及commit恢复用例，其他只读/拒绝仍可测。
5. 主代理第一次新增native接线回归7/7通过（/tmp/axiom-archive-native-first.log）。第二次当前12项Node为**11通过1失败**（/tmp/axiom-archive-native-second.log）；Rust3/3通过。失败是测试第142行读取`reconciled.job.reconciliation.retainedPath`，**status()在updater.mjs约462行明确delete current.reconciliation**，应改为检查对外message和task.status，或读SQLite验证内部字段；不是修产品暴露内部字段。此处尚未修，立即继续。

### 紧接着执行

1. 修上述测试断言；检查native Rust worker请求/返回异常边界、WindowsUI不应展示可删（现Windows执行拒绝但预览仍可删，需显式状态或说明）；check阶段预算已修，native重复hash阶段15s/整个子进程30s有界，但提交预算语义需复审。
2. 重新node scripts/build-bootstrap.mjs（本轮maintenance未再改，但检查生成一致）及build-desktop --generate-only；更新test-environment-inventory harness可选择加入archive（当前另有fixture已经编译测试），然后冻结源码委派Node全回归/tsc/cargo/只读归档复审。UI源码不变无需重复已通过14组测试。
3. Linux workflow新fixture在测试之前缺Cargo cache：可将桌面build移动到清理测试前（build会联网解析构建已有依赖，fixture --offline可用），或CI显式预取fixture依赖，不能在产品运行时下载。还需检查主程序Cargo依赖添加路径确实存在。
4. 原生publish崩溃部分写P2尚未修，考虑原子整目录发布或临时文件安全提交，不能用覆盖已有链接方式修复。
5. 更新记忆状态：整体进行中，LinuxCI编写完成但平台实测等待；归档安全修复进行中；Windows等待。无真实卸载/重启/发布。

### 原目标剩余覆盖调查

task748e7998-4e4c-418b-b9db-f87bb36790ea / resultb3e921c8-2dda-479f-9f56-1ae28a20807d：工具预览当前多是固定范围说明，缺每个版本/缓存/配置引用实际对象清单；只读扫描已覆盖已知整目录但未知旧根需要用户选择路径；setup归档/解压候选/旧版本恢复备份需各自归属终态核实；不能直接扩删。
离线工具桥目前必须后台在线。真正独立维护宿主需发布转译模块和Node/SQLite依赖闭包、同域排他接管、拆出无构造副作用入口（RtkService构造会清旧文件，ModelProxy初始化会写状态/启动线路）、资源包还依赖Store/SDK/跨作用域引用。尚未实现，不能把Linux监督内置当离线工具卸载完成。RTK统计/原文、代理订阅、Pi认证、REA手动包等保留数据的选择策略由产品逐项确认，当前不自动删除。默认编译提示仍按用户要求排除。

## 第十二轮接续（旧worker证明不足时禁止离线删除）

- **记忆纠正与安全决定**：90562cc1/52218693及追加b4ba0f26只读核实：旧worker不遵守新command-admission，后台PID死亡、无descriptor、无owner、已有新锁、当前新版本均不能证明历史worker退出；ExecutionPool fork→exec窗口和旧实例遗留无法事后补证。此前将RTK作为可删除离线例外的支持范围不充分；第六~十一轮的“RTK离线可删除”描述只保留为历史，不再是当前能力。
- **主代理已修**：tool-maintenance.ts输入白名单仅rtk.get，uninstall在任何根目录/SQLite/账本/job写入前明确拒绝；移除不可达的离线删除/受理代码，不读取或重写旧账本。RtkState增加offlineUninstall拒绝原因。原生axiom_service.rs非running路由仅rtk.get（在线rtk.uninstall不变）。cleanupRows对offline含旧host无capability一律available=false/readOnly=true，优先于scope自动启用逻辑；界面可以“查看只读范围”，展示所有路径/保留项，预览不含删除确认；在线旧预览提交前fresh核实RTK能力/摘要，变离线零删除请求。
- **当前验证**：重写offline-tool-maintenance.test.ts以当前安全能力为准，26/26（含desktop-tool-cleanup）初测通过，/tmp/axiom-cleanup-round12-initial.log。新增覆盖无descriptor、死PID、新锁、新配置、孤立版本、旧受理账本重放、未完成安装均拒绝且整树内容/inode/mtime/ctime不变；plain Node bundle同样拒绝。get保留原协调锁/进程/事务检查，只读是业务数据不变，不是协调SQLite零写入。旧删除账本测试属被暂停能力的历史证据，未来不得仅恢复旧代码就重新启用。
- **构建证据**：主代理npm --prefix app run build:desktop、generate-only、cargo check --offline（同步生成Cargo.lock）及--offline --locked均退出0（/tmp/axiom-cleanup-round12-{build,generate,cargo-sync,cargo-locked}.log）。真实生成模板内tool-maintenance.mjs隔离探针退出1并返回历史退出证明不足，临时根仍为空（/tmp/axiom-cleanup-round12-embedded-probe.log）。没有修改仓库/Pake源Cargo.lock。
- **初轮结果与修复**：01192071/4a9891cc UI24通过（/tmp/axiom-cleanup-round12-ui.log）。f5aaa7ef/12e51cb6七文件73/75、tsc0：两失败仍调用旧离线删除；主代理改command-admission测试为真实在线RtkService卸载，保留配置撤销期间跨进程准入拒绝、旧runtime撤销后不发布owner覆盖。f88cc1f5/832760f4门禁审查44/44+UI通过，未发现离线删除绕过，但P2确认原生拒绝前run(status)会chmod/建表/回收死PID启动行及cancel标记（/tmp/round12-review-agent/native-status-write.log）。
- **P2原生修复**：axiom_cleanup改run(cleanup-status)，以登记Node直接--eval内嵌tool-cleanup-status.mjs，不执行任何旧CLI、不发布helper、不访问startup数据库；只读有界读取descriptor，GET loopback /status验证token与state，禁止redirect和超大响应。非running仍只允许rtk.get；running继续原在线清理。scripts/build-desktop.mjs复制新内嵌文件；新增12项tool-cleanup-status测试验证死PID/cancel/transaction等整树内容/权限/inode/mtime/ctime不变、身份错误/redirect/超大响应拒绝及在线running保留。与command-admission合计19/19初测通过（/tmp/axiom-cleanup-round12-status-initial.log）。
- **修复后构建**：desktop build、generate-only、cargo offline同步及offline/locked均退出0（/tmp/axiom-cleanup-round12-status-{build,generate,cargo-sync,cargo-locked}.log）；生成模板helper与Rust均cmp一致，node --check新helper及build脚本退出0。UI源码未随P2改动，不重复已过UI24。
- **第二次结果及补修**：045b766d/64fe7a4e八文件87/87、tsc0（/tmp/axiom-cleanup-round12-status-{tests,types}.log）；确认改为在线RtkService的两个准入测试保留目标覆盖。e0789821/eecb6ce9再次复审确认P2：入口最前面的ensure_idle会建立setup/registry.lock及owner.lock；另P3 FIFO descriptor在fstat前阻塞open。主代理将ensure_idle移到offline mutation拒绝之后（running在线及rtk.get仍保留安装门禁），helper打开加O_NONBLOCK；新增FIFO及入口ensure_idle顺序断言。状态测试13/13通过（/tmp/axiom-cleanup-round12-status-final-initial.log）；重新generate、cargo offline同步及offline/locked均0，生成Rust/helper cmp一致（同前缀{generate,cargo-sync,cargo-locked}.log）。UI源码未变，沿用UI24及已过desktop build。
- **最终回归**：dec4fe7d/e5ec4b72八文件88/88、tsc0（/tmp/axiom-cleanup-round12-status-final-{tests,types}.log），含新增FIFO场景，零跳过/取消。
- **整个入口复审**：edcd7512/5d271214确认拒绝前零维护写入/不执行旧CLI门禁无P1/P2；实际Rust前置逻辑提取108场景（18op×6state）通过：offline仅rtk.get继续，running全部继续；只读恶意descriptor及在线adapter探针通过（/tmp/round12-status-final-audit/）。仍发现P3：installation_paths在子进程超时建立前fs::read(installation.json)，FIFO可无限阻塞并持CONTROL（installation-fifo.log）。
- **安装记录P3补修**：新增axiom_service_record.rs，所有installation_paths改用只读句柄reader：Unix NOFOLLOW/NONBLOCK/CLOEXEC，Windows OPEN_REPARSE_POINT+attribute拒绝重解析点，metadata普通文件且<=16KiB，take(limit+1)有界读取。build-desktop复制新私有模块；新增service-record.test.ts独立/tmp Cargo offline测试实际模块：正常无变更、精确上限/超限保留、目录/缺失不创建、Unix symlink/FIFO；初测2 Node+5 Rust通过（/tmp/axiom-cleanup-round12-record-initial.log）。已重generate、cargo offline同步及offline/locked0、生成模块cmp一致（/tmp/axiom-cleanup-round12-record-{generate,cargo-sync,cargo-locked}.log）。UI/业务未改，不重复已过UI24/build/88回归。
- **最终补丁验证完成**：a19f9118/63366eb9 status+record15/15 Node（含实际生产Rust模块5/5）、tsc0（/tmp/axiom-cleanup-round12-record-{tests,types}.log）。edcd7512/4ae3f127独立复审无新增阻断：临时harness使用实际生产reader+提取真实data_root/installation_paths/run、真实serde_json，5 Rust测试及build offline0；FIFO/symlink/断链/目录/超限立即拒绝，真实cleanup-status遇坏记录2–8ms返回missing，普通/边界大小及running/url兼容，登记CLI写盘哨兵未执行、CLI缺失仍可只读核实running，快照不变（/tmp/round12-record-final-audit/{cargo-test,probe,service-record-test}.log）。hardlink可只读读取，不宣称拒绝所有link；Windows reparse分支仅静态复核，祖先链接/网络文件系统/并发增长实际竞态及Tauri整链仍未实证。
- **本轮收尾与等待项**：所有委派结果已读取，无在途任务，源码冻结解除。第十二轮安全收紧、安装记录读取加固及当前macOS/隔离fixture验证已完成；第十一轮保持完成。总目标等待：旧worker退出证明及未来可信收据协议（工具离线删除仍不放行）；setup/stage/backup原始归属/终态证据（仅保留待核实）；Windows真实环境和Linux真实runner。当前rustup只有aarch64-apple-darwin，未触发远程CI、卸载本机、重启或发布。不得把完成安全收紧当成支持全部离线清理或环境已干净。
- **不能自动恢复的条件**：重新启用离线删除必须有外部可验证干净基线（例如用户另行授权跨boot重启且隔离所有旧入口，或原先从创建前就监督所有实例/后代的可信退出证明），并实现未来代次启动前dirty落盘、完整后代退出后的fsync关闭收据及锁内验证协议。当前没有该证明/协议，不能靠用户勾选“已关闭”、启动一次新后台、等待/ps扫描/删owner或重装自动恢复。此限制也不声称在线后台能追认历史孤儿worker。未操作本机服务/安装、未请求或执行本机重启。

## 第十一轮接续（REA登记下载包独立清理）

- 第十轮收尾：8ff068ec/f7ff116d验证8文件74/74、tsc0，分项错误隔离只读复审无新问题；11c634e4/a693f25a UI20+build0，主代理cargo offline与offline/locked0。RTK数据清理节点已完成；旧worker退出证明节点等待，旧版本不遵守新锁，当前没有可安全追溯的全局退出证明，其他工具离线继续拒绝。
- 新增`app/src/server/integrations/rea-download-cleanup.ts`：reaDownloadPlan按ghidra/hopper仅选config.downloads当前登记+downloadRemovalPending+global journal准确downloads父目录pending；拒绝其他文件、子目录、软硬链接，来源须storedEngineDownload匹配且非installerCopy；范围摘要绑定config revision、登记内容、目录和包/source逐文件dev/ino/size/mtime/ctime。clearReaDownloads在global builtin operation+worker barrier+config lock内检查scope，再导入scoped journal原inode（不允许仅config声明采纳），markRemovals，撤销download引用写独立pending，逐普通文件比对确认身份后unlink+rmdir，不使用递归删除；确认目录不存在再清pending+forget proof。恢复依赖原目录proof，允许部分文件已删，不要求source完整。
- `rea-runtime.ts`新增独立downloadRemovalPending类型、校验、engine revision。`builtin-operation.ts`全局assertDirectory扩展downloads导入scoped proof。`rea-removal.ts`原pending map basename先过滤准确parents目录，防Ghidra下载pending误串engines；rea.ts snapshot removalPending展示也过滤parents。
- `rea.ts`增加rea.clearDownloads：仅ghidra/hopper，confirm+config/engine revision+64hex cleanupRevision；全局独占builtin operation，借用engine job展示但不并行；支持无主程序/不支持安装平台时清理；不可取消；worker barrier内config文件锁下复核最新engine revision与scope。snapshot按两类独立提供downloadCleanup/downloadCleanupErrors。shared/rea.ts扩展job及snapshot。
- `desktop-cleanup.ts`新增两个登记下载包行，保留REA程序、引擎、其他目录和系统安装器副本；传exact cleanupRevision，结果按对应scope.paths为0与受理job匹配复核，不按程序消失。DesktopToolCleanup数据范围按钮复用。tool-cleanup.mjs及axiom_service.rs在线白名单接rea.clearDownloads；不放行离线。
- 新tests/rea-download-cleanup.test.ts覆盖两种独立清理、未知/软硬链/替换目录/无proof/installerCopy保留、包原地变化、部分删除恢复、撤销配置后文件变化拒删、已删pending路径被重建拒绝、download journal不串engine计划、异步job+barrier+确认。首次单文件通过；tsc发现test params object类型已改Record。之后增加逐文件执行身份再核对及两故障场景，最终见下。
- **已收验证**7ff8d067/c2675787：9文件81/81、tsc0；日志/tmp/axiom-cleanup-round11-{tests,types}.log。d5970f06/0256e206：UI21场景、build0；日志/tmp/axiom-cleanup-round11-{ui,build}.log，截图/tmp/axiom-cleanup-round11-ui。主代理generate-only、cargo offline（同步仅生成锁）、offline/locked均0：/tmp/axiom-cleanup-round11-{generate,cargo-sync,cargo-locked}.log。Node bridge探针2个合法scope通过、5个非法拒绝（终端输出）。
- **原审查中断及修复**：d8be4345-8960-4050-83bf-d89c1e0356e4/run91071497因服务退出取消，已读partial结果36001bb6-8922-4ce6-aecf-274514853533，不当作完成审查。已执行37/37（/tmp/rea-readonly-audit.ooBdfZ/tests.log），未确认高中风险；发现低风险“无目录proof仍启用UI，执行才失败”。主代理新增`inspectBuiltinDirectoryOwnership`只读核对global/scoped journal的root/control/原始inode，snapshot每种下载包独立核实；缺失或错配只禁该类并明确归属证明错误，不写入、不导入或收养当前目录。新增4测试（无proof只读禁用、错配不串另一类、仅config pending拒采纳、source已删空目录凭global proof恢复），单文件18/18（/tmp/axiom-cleanup-round11-proof-initial.log）。UI新增缺proof禁用场景。
- **修复后验证已完成**：2f2d8722/e37ae043九文件94/94+tsc0（/tmp/axiom-cleanup-round11-proof-{tests,types}.log）；bb12f55e/04121ef9六文件REA兼容51/51（/tmp/axiom-cleanup-round11-proof-compat.log）；2741dbd3/312b8ad2 desktop build0；UI初次定位禁用按钮名错误，仅改测试后02f0adaf UI22/22（/tmp/axiom-cleanup-round11-proof-ui-final.log及同名前缀截图）。产品文件未变，不重复build。dbc13e49/29c07e76完整独立审查无阻断发现，40/40+69/69相关测试、7/7独立恢复探针（/tmp/rea-final-audit-run/{commands.txt,tests.log,related-tests.log,probes-v2.log}），确认包/source分别缺失、空目录恢复、原始proof导入、snapshot整树无写入、损坏scoped proof分项隔离。REA节点已完成并解除冻结。原生Rust在此修复阶段未变，不重跑；后续第十二轮改动另有完整原生证据。
- **记忆工具恢复**：本轮memory_detail schema已支持新建，详情1关联REA步骤、详情2关联总目标，历史工具失败只作历史保留；后续优先受管详情，不必再因旧故障忽略详情保存。所有操作仅隔离fixture/编译，没有本机卸载、重启、发布。
- **本轮压缩前维护**：用户明确记忆维护是中间步骤、压缩后台进行、不等待且维护后继续；未改变授权或目标。MEMORY已把RTK数据清理、类型前端构建、本机原生验证标完成；REA数据清理仍进行中（等待独立审查），旧worker退出证明标等待；父目标仍进行中。下一步立即收REA审查并修复验证，不因记忆维护停止。
- **不能遗漏的剩余边界**：Windows真机及Linux真实CI runner无当前执行环境；setup/stage/backup残留无归档归属绑定，不可按名字自动删；其他工具离线不支持。现RTK离线admission仅防新版本进程，旧worker不受新锁约束的兼容性限制仍未闭环，不能声称全部离线场景安全或环境已干净。固定ps全局worker扫描快路径只在已证明正常停服后可能可用，崩溃fork→exec窗口不能放行，尚未实现。

## 第十轮接续（共同启动锁与独立数据清理）

- 用户再次要求压缩前维护后立即继续；维护是中间步骤，不能仅以已更新记忆结束。MEMORY.md增加RTK启动竞态已完成、旧worker退出证明进行中、RTK数据清理验证进行中、REA登记下载包未开始。memory_detail仍失败（详情不存在），接续事实保存在本节。
- **RTK竞态已修并验证**：a0c42d1d/04537c12证明runTool持久owner保护已登记命令，但最终barrier后新登记无共同锁，rtk-runtime的revision原先仅运行后复核。新增`app/src/server/command-admission.ts`永久SQLite BEGIN IMMEDIATE,busy_timeout0，canonical root锁，校验主/sidecar为单硬链普通文件。runTool在锁内校验signal/admissionCheck、发布owner后释放再fork，失败回调not-started。rtk-runtime提供读取最新config revision/enabled/subagents/executable的admissionCheck。offlineToolRequest依次持maintenance→startup reservation→command锁覆盖最后barrier/撤销/删除；rtk.ts在线卸载和旧版本清理也持锁。`tests/command-admission.test.ts`7场景含跨进程锁、进程崩溃释放、最后barrier后跨进程启动拒绝、旧config拒绝、链接硬链。84b138ad/b62c14c3：5文件51/51，/tmp/axiom-cleanup-round10-admission.log。d5009b39/9d0af80b：tsc0、只读审查无新缺陷，/tmp/axiom-cleanup-round10-types.log。
- **旧worker兼容未闭环**：8cb3b624/c11f740b建议boot迁移（过重，未采纳实现）；追加f9d73f3e认为固定绝对路径ps全局扫描agent/memory/compression-worker.(js|ts)可用于已证明正常关闭的已知托管版本；不能凭PID死/descriptor缺失覆盖崩溃fork→exec窗口。正常池close等实际child close，service.close后删除descriptor，stop返回token变更不等同原后台退出。其他工具离线仍未放行；现RTK新锁不追溯约束旧worker，这个限制必须保留并继续解决。没有实现ps快路径、boot迁移或新的正常关闭收据。
- **RTK保留数据实现**：新增`integrations/rtk-data.ts`的rtkDataScope/clearRtkData。固定父链managedDirectory，stats预览绑定config revision+主DB身份+最多5000条排序rows摘要，所有sqlite sidecar拒绝链接/硬链；清理事务DELETE effects不删DB文件、不声称缩小或物理擦除。originals限1024枚举，仅严格UUID.txt普通单硬链文件可删，其余逐项retained；scope绑定父目录及每项完整metadata。clear先改config revision撤销旧filter结果，再删选定数据并复核count0。
- 新接口`rtk.cleanupStats/rtk.cleanupOriginals`与旧即时clearStats/clearOriginals分开。rtk.ts预校验confirm+config revision+64hex cleanupRevision，异步RtkJob，worker removal barrier内共同command锁+assertToolProcessesStopped+clearRtkData，结果保存并load。shared/rtk.ts新增RtkDataScope、dataCleanup/dataCleanupError与两种job kind。offline host仅兼容读取新job kind，**不支持离线数据清理**；native whitelist只在线透传新op。
- rtk-runtime最终保存原文/记stats改为在command锁内再次current()，skip记stats也持锁但失败忽略；避免owner结束后回调重建刚清掉的数据。rtk.ts snapshot在锁内给出dataCleanup，错误独立dataCleanupError不影响程序卸载。
- DesktopToolCleanup显示RTK数据范围错误和数据清理按钮，desktop-cleanup.ts新增stats/originals两行，scope按数据类型选择，原文回查失效/不可撤销/后续新数据文案，复核按count0与job结果，绝不按程序消失。tool-cleanup.mjs白名单两新op强制cleanupRevision；axiom_service.rs顶层允许两新op但offline白名单不放行。
- **首次测试发现已修**：stats只读SQLite连接也重建WAL/SHM，原用全sidecar身份摘要导致连续snapshot不稳定；现改主DB身份+实际rows语义摘要，旁文件仍作类型/硬链校验。`tests/rtk-data-cleanup.test.ts`7场景含stats/original独立清理、barrier期间新增拒绝、未知/链接/硬链保留、linked parent/DB拒绝、迟到filter不回写、UI不按程序消失误判。
- **最新验证**597cf323/9b5ee528：7文件66/66、tsc退出0（/tmp/axiom-cleanup-round10-data-final.log、-types.log）。覆盖rtk-data-cleanup、command-admission、offline-tool-maintenance、rtk-removal、rtk、rtk-worker、desktop-tool-cleanup。当前c5c7ef60独立数据审查仍在途，覆盖文件冻结。新增数据代码后桌面build/UI、generate-only、cargo offline/locked尚未跑，须完成；后续任何源修改要重跑受影响检查。未操作本机卸载/后台/发布。
- **REA下载包下一步已读依据**：75f7936f/e41d2796建议仅当前登记downloads，Hopper系统私有副本保留；要有持久pending/原inode，未知额外文件勿删。`rea.ts`已具global exclusive operation+worker barrier+withResourceFiles流程（235-262），可新增clearDownloads kind复用。`builtin-operation.ts`managedPath本已允许rea/downloads ghidra|hopper-UUID；markBuiltinRemovals可记录这些路径，但assertDirectory约223目前只为engines转移scoped proof，需扩展downloads。删除中断可以用builtin pending paths恢复，不能用config丢失后重新收养新inode。`rea-engine-download.ts`storedEngineDownload绑定package/source身份但metadata读跟随链接风险需额外普通文件检查；Hopper私有副本不在config，必须保留。本轮尚未修改REA相关文件。
- **审查与修复补充**：c5c7ef60/7ca0520d未发现误删/回写阻断问题，但P2：stats异常连带隐藏originals。已改RtkState.dataCleanup为分项可选、dataCleanupErrors按kind返回，snapshot各自try，UI独立展示错误、验证只看目标错误；新增双向异常隔离用例。8ff068ec测试/tsc在途，源码冻结至完成。
- **后续验证已收**：11c634e4/a693f25a UI20场景（新增数据范围确认、unknown保留与cleanupRevision透传）、桌面build退出0，日志/tmp/axiom-cleanup-round10-{ui,build-final}.log，截图/tmp/axiom-cleanup-round10-ui。de25125b/9c6884d6初次build+generate成功，cargo --locked因模板复制旧lock退出101；主代理随后cargo check --offline同步生成目录锁及--offline --locked均退出0，日志/tmp/axiom-cleanup-round10-cargo-{sync,final}.log。未改源码锁。
- **REA设计补充**6e0c61df/6dc3097e：clearDownloads按ghidra/hopper独立项目，全局builtin operation，与安装/下载互斥；下载pending独立配置不与engine混淆，scope需绑定package/source身份而非仅目录。builtin assertDirectory扩展downloads导入scoped proof，不能缺proof收编未知目录。当前已核对实现，尚未编辑REA代码。旧reaRemovalPlan将全路径pending降basename会串入downloads，新增功能必须同步按实际父目录过滤。
- **剩余执行顺序**：完成8ff068ec复核；实现REA登记下载包独立清理并接桌面；相关构建/UI/原生重新验证；其他工具离线占用证据仍需解决，不能未经证据直接放行。Windows真机与Linux CI需外部环境，状态等待。工作树大量他人改动勿覆盖，锁文件仅主代理同步。

## 第九轮接续（指定旧目录与安装残留清单）

- 7dea1095/e867607b复审四项修复已确认，17专项过；发现P2严格ps模式仍要求xray run。主代理改为strict下完整executable命中即计为占用，兼容其他运行调用；新增真实隔离node fixture携带-config参数。OpenCLI测试同时增加worker gate内改变目录后拒绝、配置未创建、原目录保留。6c231916/f4509341两文件17/17退出0（/tmp/axiom-cleanup-round9-scope.log），无需重复跑未改工具全套。
- 7908d974/4472cf0b调查已收：旧目录扫描内核可复用，必须selected单独模式，现有后台OpenFileDialog不适用于无后台场景。本轮选用完整路径输入，不新增系统picker依赖。
- 已实现原生命令可选root：校验绝对路径/长度/控制字符/相对段，selected worker走单目录metadata scan，origin unknown/automaticRemovalAllowed false；不读取正文、PATH或当前客户端。不传root仍旧当前扫描。原生SCANNING与UI inFlight统一串行化，清理回调仍scan(true)不带root。
- DesktopEnvironment新增指定旧目录区、独立结果与错误。校验响应scope/origin/removal/root一致；切换输入清除旧结果。共享类型optional字段兼容旧fixture。当前扫描残留列表只读呈现，所有选定来源都没有卸载动作。
- 残留清单：安全目录handle枚举setup/updates/service/node_modules/@cosyeezz，后者仅名称以.axiom2-update-/.axiom2-backup-开头者。setup任务中的固定axiom2.tgz单列；每类最多访问128直接条目、共享总时间/数量预算、不跟随links、不读凭据。每项明确保留待核实，无自动删除许可。目录不递归计大小，归档只读metadata。外部登记安装位置未读，不能声称全面残留扫描。
- 新测试：原生selected独立与不泄露正文、输入验证、missing不创建、残留分类与保留、128上限、selected/残留链接；脚本新增selected worker真实调度。99e22589/633b9b5a原生14/14+current/selected集成退出0，全offline（/tmp/axiom-cleanup-round9-native.log）。
- 13f3b934/99cce216审查已收：未发现阻断安全问题；两项P3已修：共享类型导出isEnvironmentInventory验证所有嵌套条目、残留行/commands/notes，UI畸形项先拒绝不渲染；残留改每类别128额度，setup140项测试仍显示backup。
- 1b6cf1a4/f83852aa首次UI失败仅因测试把当前请求要求null而bridge默认{}，主代理修断言为{}。最终1b6cf1a4/8a957c75：tsc退出0、build74模块、UI19场景全部通过（/tmp/axiom-cleanup-round9-final-{types,build,ui}.log，截图/tmp/axiom-cleanup-round9-final-ui/screenshots）。99e22589/8656e85a最终原生14/14+两模式集成过（/tmp/axiom-cleanup-round9-final-native.log）。源文件均未再变化，不需重跑这些检查。
- 主代理已generate-only、cargo check --offline（仅同步生成目录锁）、cargo check --offline --locked，全部退出0：/tmp/axiom-cleanup-round9-{generate,cargo,cargo-locked}.log。manifest artifacts/pake-template/src-tauri/Cargo.toml。无重启或发布。
- 当前无测试在途、无测试冻结。a0c42d1d/83acee27离线调查已收，追加核查现有RTK是否有同类风险在途（input ffc98636）；e590c9c6/dc09bddc保留数据调查已收。详见下段。
- 接续先收上述验证与审查，修问题后跑受影响检查；再推进剩余调查结论。无本机卸载。记忆详情工具仍返回详情不存在，本文是完整接续依据。

### 第九轮压缩接续：剩余推进依据

- 用户再次要求压缩前维护，维护后立即继续，禁止仅“已更新记忆”结束。主文件已将指定目录、托管工具实际清单及验证、残留逐项展示标完成；增加其他工具离线边界和保留数据独立清理进行中。总体仍进行中。memory_detail工具仍报详情不存在，本文保存事实。
- **其他工具离线调查** a0c42d1d/83acee27：可复用现宿主启动预约/维护SQLite锁/请求账本。OpenCLI需从service私有uninstall提取纯函数；REA可复用removeRea但必须beginBuiltinOperation全局operation+withResourceFiles，不能脱离AsyncLocal上下文否则可选断言失效。新op摘要含配置revision+cleanupRevision+engine+confirm。不得自动reconcile interrupted记录（macOS恢复会启动ps）；模型代理需要进程枚举、资源涉及npm和引用，不可简单白名单放开。
- **关键未决风险**：现有ExecutionPool fork worker无持久退出证明，后台死不等于worker子树退出。其他工具离线不能直接删除。主代理追加a0c42d1d核查现有RTK是否也受影响：要求结合rtk-process/runCommand归属记录、rtk-removal的配置撤销及同步临界区、service-startup预约给出实际竞态/最小共同admission修复；不能仅从无worker owner推断不安全。该append仍在途，先收结果再决策，不凭猜测关闭现有功能。
- **RTK保留数据调查** e590c9c6/dc09bddc：rtk.clearStats/clearOriginals是现成在线API，当前仅confirm+pending检查，未worker barrier、未scope身份。clearStats执行SQLite DELETE，任务可立即新增，不保证文件缩小/物理擦除。原文cleanRtkOriginals使用statSync/readdir后rm UUID.txt，无父链/链接/硬链接/身份确认；不能直接暴露为安全精确范围清理。严格支持应复用worker maintenance barrier，并新增固定根路径/身份摘要及清理任务，桌面结果须独立判断，不能按程序消失判成功。不要改动凭据或用户设置。
- **REA downloads**：没有clear API；rea-engine-download.ts storedEngineDownload已有package/source两文件dev/ino/size/mtimeNs/ctimeNs身份，可作为计划起点。只覆盖当前登记ghidra/hopper包；旧包和Hopper由系统安装器异步使用的私有副本不登记，必须保留。可设计rea.clearDownloads在REA全局operation+配置锁下清选定登记包，scope同时绑定config/目录/两文件。未登记包不能仅文件名递归删；Hopper系统读者未证明退出，不能自动处理其副本。
- RTK没有独立downloads目录，下载归档藏versions暂存，不能删整个版本冒充数据清理。第九轮只读残留不解决setup归档缺持久收据问题；现可执行归档删除仍仅updates/<hash>-axiom2.tgz。
- 已读：tool-maintenance.ts（barrier只查service-control PID、root .axiom-command-*.json、setup owner/updates事务，再核RTK配置/目录）；rtk-runtime.ts读取config snapshot，执行前后比较revision；rtk.ts clearData现无worker barrier（90行），程序uninstall有；rtk-stats.ts；execution-pool.ts（fork约184、maintenance约333）；desktop-cleanup.ts和tool-cleanup.mjs（尚未放行clearStats/clearOriginals）。本次尚未修改这些剩余方向的实现。
- 下一步：先收RTK占用风险调查；若成立优先修复已交付离线路径，随后实施保留数据独立可选清理/其他工具离线。Windows和Linux真runner仍依赖外部执行条件，不能声称全平台通过。未执行本机卸载/重启/发布，其他人的工作树更改勿碰。

## 第八轮接续（清单验证与代理旧版本占用修复）

用户要求记忆维护后继续，未改变授权。未真实卸载、重启或发布，所有删除验证为临时fixture。详情工具仍不可用，文档为接续事实来源。

已收：e6b9701a/3362ae61 独立RTK三文件42/42（含legacy账本），该子目标完成。f7f92598/b4b5a2e1 六文件46/46，唯一tsc错误是新增测试state.engines可选类型（已加断言修）。b9c82e6e/771894b0 初版UI14场景/build过；后续74ffc85d最终UI15场景/build过（新增online cleanupRevision透传），日志/tmp/axiom-cleanup-round8-final-{ui,build}.log，截图/tmp/axiom-cleanup-round8-final.YNNaLE/screenshots。主代理generate-only+offline cargo同步仅生成模板锁+offline locked均退出0，最终日志/tmp/axiom-cleanup-round8-final-{generate,cargo,cargo-locked}.log。未改源码锁文件。

7dea1095/a39127bc审查发现P1代理删除全部旧版本但只核当前installation进程、P2桌面可省略摘要/P2 worker停止前不预检/P2 REA未登记引擎不可见。主代理已修：
- model-proxy-kernel.ts installedKernelPids接受string或数组，requireScan=true在Windows/ps失败显式拒绝；ps带2秒超时。旧启动/停止调用仍原可选模式，不改其功能。model-proxy-removal.ts assertProxyStopped(root,kernel,paths)按本次plan全部路径一次查询，model-proxy.ts传plan.paths。
- OpenCLI/REA/RTK在worker barrier之前先assertCleanupScope，同时保留barrier内复核。
- tool-cleanup.mjs六种程序卸载强制64hex cleanupRevision；原工具页后台接口兼容undefined。desktop-cleanup.ts在线无scope按钮禁用并提示更新/核实；离线RTK仍走独立摘要协议。按钮不可用文本改“当前不可自动卸载”。
- REA snapshot有界枚举engines，已登记外的合法目录填engine.cleanupUnverified，shared增加字段，UI显示“未登记残留（不可自动删除）”及路径，复扫有该残留不会verified，不扩大删除权限。

新增测试：tool-cleanup-scope.test.ts 6项（scope身份/数量/链接，OpenCLI有归属记录但无配置目录预览/变化拒绝/新确认删除，REA主/java替换拒绝与barrier零调用，proxy kernel/importer变化拒绝）；desktop-tool-cleanup新增bridge必须摘要、孤立scope路径、缺scope禁用/未登记引擎不verified；model-proxy-removal新增旧xray进程在当前配置/无配置两种状态拒绝、ps失败拒绝；rtk-removal新增清单与stale scope不进barrier；UI第15场景验证在线digest透传。主代理先跑scope+desktop+proxy24/24，之后补REA/RTK门禁断言，最终9文件在途。

在途/冻结（最新）：f7f92598/017712a5最终9文件**93/93**、tsc退出0已收（/tmp/axiom-cleanup-round8-final-{tools,types}.log），b9c82e6e/74ffc85d最终UI15/build也已收。只剩7dea1095复审四项修复，相关实现冻结至收结果。7908d974只读调查旧安装来源选择仍在途。ea3ebb34/18f61752安装残留调查已收，见下段。无测试在途。

下一步：收最终测试/复审，失败主代理修后重跑受影响项。RTK再次变更需检查offline fixture；原生模板现为本轮最终代码已通过。继续未知来源选择、安装残留、保留数据独立清理、其他工具离线。Windows代理卸载现在明确无法核实占用而拒绝，未声称平台全支持。Linux/Windows真实runner尚未执行。

### 压缩接续（用户要求维护后立即继续）

93项测试命令：`node node_modules/tsx/dist/cli.mjs --test app/tests/tool-cleanup-scope.test.ts app/tests/desktop-tool-cleanup.test.ts app/tests/opencli-private.test.ts app/tests/opencli.test.ts app/tests/rea-removal.test.ts app/tests/model-proxy-removal.test.ts app/tests/rtk-removal.test.ts app/tests/offline-tool-maintenance.test.ts app/tests/rtk.test.ts`；`node node_modules/typescript/bin/tsc --noEmit -p app/tsconfig.json`退出0。UI用本机Chrome、独立profile，源码最后变更后15场景通过。cargo最终generate-only+主代理仅生成锁同步+--offline --locked过。无需重跑未变化检查。

剩余推进方向：
- 旧安装来源选择：已读DesktopEnvironment.tsx/shared/environment-inventory.ts/axiom_environment.rs/process.rs。现DesktopEnvironment只有当前root扫描，清理后onRescan=scan(true)必须始终当前安装，不可让用户选择旧根后误将它作为本次卸载核实。计划单独只读旧来源面板/独立结果，保持当前扫描与清理目标；等待7908d974提供本机目录选择接口调查。Rust扫描已接受内部root，native axiom_environment目前不接受参数；仅授权本机受信窗口、SCANNING全程串行化须保留。未知来源扫描不赋予删除权限，不修改installation登记/启动路径。
- 安装残留调查ea3ebb34/18f61752结论：当前无证据闭环可直接自动删setup/stage/backup。最小潜在未来类别setup/<taskID>/axiom2.tgz，现下载校验摘要只在内存，创建时文件/父目录身份未持久化；预览时hash不能补证明归属。setup目录有owner.lock/job.json/task.json，原始终态+租约空闲仍不足，service-owner.json残留需拒绝。stage在transaction前创建，因此无journal不代表无任务；backup/previous-version承担恢复用途，未绑定inode与task身份，不能凭名称/年龄删除。先有界逐项只读展示，记录缺失/损坏/未核实，所有这类删除按钮禁用；未来需安装时先生成归档收据再拓展执行器。现archive executor固定updates/<hash>-axiom2.tgz，不能把setup路径塞入或搬过去绕过归属。
- 其他工具离线宿主、保留数据独立清理仍未实现；Windows代理占用扫描明确拒绝，Linux/Windows真runner未验证。不得宣称整体完成或环境已干净。
- 未执行任何本机卸载/重启/发布，所有验证隔离。大量他人未提交改动不碰。详情工具依然返回“详情不存在”，主文件标题+本文保留接续。

下一步先收7dea1095复审与7908d974调查；无新增问题则将“补齐托管工具实际卸载清单/验证路径身份确认与复扫结果”标完成，再推进旧来源独立扫描和残留逐项展示。不要停在记忆维护。

## 第七轮接续（请求账本与实际卸载清单，验证未完成）

用户要求压缩前记忆维护后立即继续；授权不变，只写产品代码和隔离fixture，未真实卸载、重启或发布。详情工具依然返回“详情不存在”，主文件与本节为接续依据。**所有委派已收，无在途任务，冻结全部解除。**

### 已收验证与新修复

- 8fe60d45-7c47-41ae-b15f-fcd8f2898615/resultaa02b7ca-739a-496c-9ef4-17b3c5d3b205：offline-tool-maintenance+rtk-removal+rtk测试41/41，tsc退出0，/tmp/axiom-cleanup-round7-{rtk,types}.log。验证账本A失败→B覆盖→旧A不重放、首条job落盘失败仍保留受理、非字符串ID零写入。
- 61fa92e4-1821-458a-a4fe-0de04de4f3e4/resulta1580aba-5895-4985-b0ac-c7a228271b9c：新账本无P0–P2；27/27及独立探测通过，YAML uniqueKeys+两独立step断言通过。发现P3旧job同ID但无账本会直接成功返回，无参数绑定。主代理已改此分支为throw“此旧请求缺少参数记录…不会重复执行”，并新增legacy job测试；**此后尚未重测**。探测/tmp/axiom-readonly-review.BKQjVM。
- c9be18f1-0428-48f3-b0c5-35f64b6d232d/resultbf6aab5c-af94-4347-96de-dd7dcd8a0c90：生成bundle语法/纯node依赖/账本嵌入验证过；cargo --offline --locked退出101因generate-only每次复制pake原锁后注入依赖需同步。追加result90ead7e2-04b0-4276-a245-0fb1cf233269子代理自有边界禁止改锁，因此未执行offline同步，**主代理需自行cargo check --offline（只更新artifacts生成目录锁），再委派--locked复核**。无需用户授权，无需联网；本轮源码又改，先重新generate-only。
- f66d8ed5/resultf9d9e96d-4475-4a74-9538-894b9f850235：Chrome隔离UI14场景全过，/tmp/axiom-cleanup-round7-ui.log及6截图。其后UI已改，必须重跑。之前build:desktop已过但也需重跑。
- 5c26dfe9/resultc31aedb9：inventory默认offline10项+worker过；Windows pwsh失败传播风险已拆两独立CI step，61fa复核确认。Linux/Windows真runner仍等待。

### 第七轮实际清单已改源码（未验证）

目标：当前+旧版本+pending的完整实际目录展示；确认绑定目录身份摘要，变更则拒绝，不扩大删除范围。

1. 新`app/src/shared/cleanup-scope.ts`类型`CleanupScope={paths:string[],revision:string}`；新`app/src/server/integrations/cleanup-scope.ts`将去重排序路径+dev/ino/mtimeNs或missing标记SHA256，最多1024，拒绝非目录/链接；`assertCleanupScope(expected,actual)`仅当传入expected时强校验，保留原工具页全托管卸载兼容。调用前路径必须来自固定根计划。
2. `managed-removal.ts` managedChildren改opendir串行有界最多1024条（含不匹配项），保留逐目录身份校验。影响多个工具及离线RTK，需回归。
3. 新`opencli-removal.ts`抽`openCliRemovalPlan(root,config,pendingPaths)`，含versions/current/pending，校验托管边界，返回names+paths；OpenCliService.snapshot返回cleanup，uninstall门禁内复核cleanupRevision，再原有归属/配置撤销/删除。删了已不使用basename和managedChildren imports。
4. `rea-removal.ts`抽`reaRemovalPlan(root,config,pendingPaths,engine?)`，只主程序枚举versions；引擎仍只登记记录+pending，不收养未知同名目录。removeRea新增scopeRevision参数，删除前复核；ReaService.snapshot主程序和引擎各cleanup（合并主/engine pending）；调用传p.cleanupRevision。Skill/MCP仍只关闭接入；下载包不扩删。
5. `rtk.ts`在线snapshot增加cleanup及cleanupPaths，通过共用rtkRemovalDirectories；removeRtk回调在门禁内assertCleanupScope。离线宿主仍用原revision绑定，不多传cleanupRevision。
6. `model-proxy-removal.ts`两个plan增加paths，预览importer使用verifyStopped=false（不查/停进程）。ModelProxyService.snapshot返回按kernel的cleanup、cleanupError及importer.cleanup；内核卸载等待stop前后两次复核cleanupRevision，importer删除前复核。
7. shared `builtin-tools.ts/rea.ts/rea-engines.ts/rtk.ts/model-proxy.ts`增加可选cleanup字段；proxy另有cleanupError。
8. `desktop-cleanup.ts`末尾map行加入实际目录+params.cleanupRevision，可见孤立目录启用按钮；复扫针对REA/OpenCLI/proxy的cleanup.paths非空不允许verified。RTK避免在线重复展示。代理文案收紧为所列托管版本，历史runs保留单列核实；cleanupError参与内核复扫失败。
9. `DesktopToolCleanup.tsx`允许有cleanupRevision时空配置revision（孤立安装），确认说明加入目录身份。`tool-cleanup.mjs`仅六个程序卸载操作允许cleanupRevision且64hex；空revision仅带有效scope摘要可过；其他白名单不变。在线预览后若停机走离线宿主会拒绝未知cleanupRevision，安全要求重新预览。
10. 中间tsc已退出0（/tmp/axiom-cleanup-scope-types.log），**不是最终验证**，随后还有UI/共享helper变更。

### 下一步立即继续

1. 写`app/tests/tool-cleanup-scope.test.ts`或扩现有fixture：六类OpenCLI/REA主/java/RTK/xray/importer具体路径完整、重复snapshot不写文件/不执行命令、目录新增/替换导致卸载拒绝且配置不变；helper顺序稳定/链接/1024上限；bridge scope参数和无config孤立目录；UI leftover不报verified。可以复用opencli-private、rea-removal、rtk-removal、model-proxy-removal fixture。**尚未写该文件。**
2. 已读现有fixture：opencliFixture支持模拟安装不联网；REA config fixture含installation、managedEngines.java和external保留；Proxy构造会publishRuntime但snapshot只读，测试要在构造后记录基线，不调用initialize；RTK构造prune保留当前+前一版本且24小时内不删，测试2目录即可。
3. 增加environment-inventory.check.ts至少在线RTK/其他工具实际路径与scope摘要透传fixture（当前offline RTK的两路径场景已有，14场景）。用AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'从app目录跑。
4. 冻结后并行测试：offline-tool-maintenance（新增legacy后20项）+rtk-removal+rtk（预期42），opencli-private/rea-removal/model-proxy-removal/desktop-tool-cleanup/newscope，以及其他受managedChildren影响的相关测试；tsc和build:desktop。独立审查计划与执行一致、移除阶段异步竞态、无误报干净。
5. 更新模板：node scripts/build-desktop.mjs --generate-only；主代理CARGO_TARGET_DIR=/tmp/axiom-environment-native-target cargo check --offline --manifest-path artifacts/pake-template/src-tauri/Cargo.toml同步生成锁，然后--offline --locked。不要让仅允许只读任务自行改锁；不需联网。
6. 原范围其余缺口继续：未知旧根需来源选择及所有权证据；setup/stage/backup虽有部分task/transaction但无安全完整删除授权；保留统计/原文/下载包等独立可选清理；其他工具离线宿主。不能声明整体完成。

### 覆盖调查依据

9a149bc6-ea53-48be-9b69-611284d62a2f/resulte33d035d-51e3-4ee9-82d8-90d5688a6519已读。资源/MCP已有实际cleanup，主要缺配置实际文件/独占缓存细化；不重写跨范围引用。MCP凭据文案应明确不再引用OAuth可能自动移除，勾选只针对专属凭据。setup有registry.lock/owner.lock/task.json，stage在transaction前创建（无journal不等于孤立），previous-version用于恢复（不等于删授权）；旧setup/axiom2.tgz无任务归属。不能按名字/时间整删共享缓存、旧根或备份。

## 第六轮接续（RTK独立离线维护）

前轮剩余复核全部已收。7eb8e925/result829d44a4复核YAML19块语法通过，但发现Windows发布接受同内容硬链接，已补GetFileInformationByHandle句柄级nlink=1及Windows专用测试；04d8b1b6/resultcf9f11df已复核FFI布局52字节/偏移正确，mac隔离发布4项通过、inventory10项通过（/tmp/axiom-cleanup-round6-{inventory,bundled}.log），Windows尚未实际编译运行。

归档Rust fixture已加入AtomicU64避免并发时钟重名；cf74b0a5/resulte67c60f8全Node回归70/70通过、退出0（/tmp/axiom-cleanup-round6-node.log）。这是七个文件全回归，不包含后写的RTK宿主。

### 新实现与已通过验证

- 新增`app/src/server/integrations/rtk-removal.ts`，抽取在线卸载原有配置撤销/versions+pending枚举/删除/复扫核心；RtkService继续用在线进程门禁和维护流程调用，新增删除后重枚举才清pending。
- 新增`app/desktop/tool-maintenance.ts`纯一次独立宿主，`tool-maintenance-entry.mjs`有界stdin入口，`scripts/build-tool-maintenance.mjs`esbuild纯内置Node闭包；接入build-desktop模板tool-maintenance.mjs和axiom_service.rs。在后台缺失/停机/控制失败时仅RTK get/uninstall可以切离线，并独立复核，未把其他失败误当授权。
- 离线宿主只接受固定根目录和RTK操作，持service-maintenance.sqlite BEGIN IMMEDIATE并预约service-startup（64位token/live PID，陈旧记录仅验证进程退出才条件回收），复核service-control PID已退出、无未核工具owner、无setup owner/恢复transaction。记录类型/硬链接/符号链接/FIFO/大小、目录边界和条目数有检查。不构造RtkService，不启动定时器/后台、不联网。
- 只读快照返回实际版本路径与SHA256配置+目录dev/ino/mtime摘要revision；UI展示逐目录范围，确认重算。job id=requestId，已有同id不重放；中断job显示失败/未知且不自动重试，其他运行中安装检查拒绝。卸载保留过滤设置/效果统计/原文，终态写job.json并再次快照复核。
- 新`offline-tool-maintenance.test.ts`16项覆盖停机/锁/启动预约/未知进程记录/事务/预览变更/请求重放/孤立版本/linked config/FIFO/纯Node bundle与stdin上限。d739ce35/result49da33da已收：连同在线rtk-removal与rtk共38项通过；tsc退出0。日志/tmp/axiom-offline-rtk-{tests,types}.log。
- 模板已generate-only；f2253341/result5645ee3d已收：cargo check --offline及--offline --locked均退出0，模板bundle仅Node内置依赖且node --check通过。锁文件已同步。日志/tmp/axiom-cleanup-round6-cargo{,-locked}.log。
- 最新追加CI：mac/windows构建后跑inventory原生测试（Windows硬链接测试在此执行）及RTK离线/在线卸载；Linux原检查加同样内容。inventory fixture支持AXIOM_TEST_CARGO_FETCH=1构建期预取精确依赖，test/build仍offline。尚未经真实远程runner。
- UI fixture加offline=true和两实际路径，断言内置维护提示/旧版本路径；原14场景继续验证。

### 最新接续（用户要求压缩前维护后继续）

21ad2e70/resultb59493b3已收：复核确认正常路径和SIGKILL中断保留pending，但有2项P2待立即修：①同requestId去重仅检查最新job.json，A失败后B失败覆盖记录，再重发原A会执行；需独立持久请求账本（受理前落盘，绑定操作+参数摘要，已受理请求永不重进删除阶段）。②command未检查typeof requestId，数组[UUID]正则转换可通过并写坏job.id；需入口字符串类型检查和回归。复现程序/private/tmp/axiom-rtk-readonly-audit.ilpUrH/probes.ts、crash.ts，原16项host测试过但不足覆盖这两项。现已修：入口typeof字符串校验；tool-maintenance.sqlite独立requests表持久化id+操作/参数SHA256+job，INSERT独立提交在任何job/config变更之前；同ID不同摘要拒绝，相同ID只返回已存结果，中断则报未确认且不自动重试，不受最新job覆盖影响。新增A失败/B覆盖/重发A、初次job发布失败、非字符串ID零写入三项测试，bundle测试也检查数组ID。等待独立验证。

f66d8ed5/resultf5d17cb6已收：build:desktop退出0；最初UI缺Playwright browser失败。已指定本机Chrome隔离profile重跑：resultf9d9e96d-4475-4a74-9538-894b9f850235退出0，14场景通过，含offline路径/提示及不自动删除。/tmp/axiom-cleanup-round7-ui.log，6截图在同名前缀目录。

5c26dfe9/resultc31aedb9-cddf-4419-a5cf-7875d3099f54已收：YAML uniqueKeys及Unix20块bash -n过，inventory默认offline Rust10项+worker fixture全过。发现Windows pwsh两命令第一项退出码可能被覆盖，主代理已拆成两个独立run步骤，待静态复核。

已重新generate-only成功（/tmp/axiom-cleanup-round7-generate.log），归档源码未变不重复70项。

### 在途与冻结

- 8fe60d45-7c47-41ae-b15f-fcd8f2898615：RTK41项预期+tsc，/tmp/axiom-cleanup-round7-{rtk,types}.log；冻结host/core/tests及app类型相关文件。
- 61fa92e4-1821-458a-a4fe-0de04de4f3e4：持久账本独立复核+workflow静态检查；冻结host/workflow。
- c9be18f1-0428-48f3-b0c5-35f64b6d232d：新模板cargo check --offline --locked及纯Node bundle核验；冻结生成模板/原生相关文件。
- 9a149bc6-ea53-48be-9b69-611284d62a2f：其他组件路径预览及残留覆盖调查（只读）。
- 上述结果通知后read_result，不轮询。失败修复后仅重跑受影响覆盖；不要声称全目标完成。

### 仍需推进的覆盖

e1352680/result4016136a只读覆盖调查已收：托管OpenCLI/RTK/REA/代理大多已有旧版本清理；重点缺口是各工具实际对象预览（RTK离线本轮补）、未知其他Node/npm/旧根来源选择、setup与stage/backup按完整归属记录清理、独立可选保留数据清理。未知来源或共享缓存不能按名称/时间整体删除。资源/MCP已有共享引用与专属凭据确认机制。其他工具离线仍需后台运行。Linux/Windows真机证据等待相应runner，不标通过。

记忆详情工具仍报详情不存在；主文件原链接和本节作为接续。没有本机真实卸载/部署/重启/提交。

## 第五轮接续（恢复竞态与原子发布）

用户再次要求压缩前维护记忆后立即继续，目标授权不变。只开发与临时fixture验证，未真实卸载/部署/重启。主文件详情工具仍未成功关联；本节是接续正文。

### 最新源码及验证状态

1. 第四轮12项归档测试唯一失败已修：status主动剥离job.reconciliation，改读fixture SQLite内部字段，未暴露产品内部状态。随后12/12+Rust3/3通过（/tmp/axiom-archive-native-third.log）。
2. 第四轮回归taskbb8e1c06-0936-4481-964f-a74450686a48/result29ba97eb-b2c0-4abc-9b48-85c95a00e01c已读：66/66全过；tsc曾报其他并行工作的rea-install-cached.test.ts JAVA_HOME类型错误。此错误由其他工作修复，主代理未改该文件，第五轮tsc已过。
3. 主代理手工发现恢复竞态并修复：父Node退出时worker可能尚未取flock，inspect先取锁不能证明稍后的worker不会提交。`axiom_archive.rs`现在inspect持同一锁创建并fsync `archive-stopped-<taskId>`，remove见记录拒绝；任何迟到worker都被撤销。remove/inspect均在锁前验证updates dev/ino。`updater.mjs`claim为archive-remove持久化archiveCommit='not-started'；spawn前先writeJob({archiveDirectory:preview.directory,archiveCommit:'prepared'})。reconcile只有not-started可以不调worker；prepared必须用原directory取锁撤销，路径换目录不能误判停止。not-started无效载荷也能核实，无需JSON解析id。新增Rust两例（延迟worker撤销、目录替换核实拒绝）及Node提交准备前中断例。主代理中间13项Node+5项Rust通过（/tmp/axiom-archive-native-fourth.log）。
4. `archive-cleanup.mjs inspectArchives({platform=process.platform})`：Windows已核摘要的归档仍列unverified、targets为空，明确不支持安全删除；新增模拟Windows用例，避免提供失败按钮；预算删除测试win32跳过。现在archive Node应14项。
5. `axiom_bundled.rs`修P2半写缓存永久拒绝：runtime目录名升级desktop-runtime-v2-<hash>避开旧半文件；Unix先唯一staging写完fsync，再macOS renameatx_np(RENAME_EXCL)/Linux syscall renameat2(RENAME_NOREPLACE)原子不覆盖发布；失败清理staging，EEXIST精确核内容/单链接。Windows同样staging+MoveFileW不覆盖提交。新增中断staging后重试+8线程并发发布测试，原符号/硬链接拒绝测试保留。未实测Windows/Linux平台分支。
6. Linux CI完善：先build:desktop+build-desktop --targets deb后跑测试；fixture Cargo精确pin依赖可能未被主构建缓存，因此`archive-worker.ts`仅当AXIOM_TEST_CARGO_FETCH=1时在测试设置阶段cargo fetch，CI显式设置该值；测试cargo test/build仍--offline，产品运行时不下载。desktop-native测试增加x64/arm64成功与跨架构拒绝两例（应6项）。workflow在产物验证后调用最终Axiom2-binary --axiom-archive-worker inspect（临时真实目录dev/ino、无DISPLAY/WAYLAND_DISPLAY、10s超时），验证无GUI分派。
7. 已重新生成模板：node scripts/build-desktop.mjs --generate-only（/tmp/axiom-cleanup-round5-generate.log）。第五轮原生验证taskb5a32db7-1df4-467f-8290-14b6236b9d6f/result7e736fba-234d-4fab-a9a9-d5b178568a1e已读：inventory Rust10/10（bundled2），真实worker fixture5检查过；cargo check --offline原模板退出0（允许更新生成Cargo.lock，上一轮--locked失败已解决）；日志/tmp/axiom-cleanup-round5-{inventory,cargo}.log。仅dead_code警告。模板当前archive/bundled生产源码一致。
8. **最新全回归taskb5669962-99ff-4234-bc17-2701978c9946/resultd851e941-895e-4508-8b3a-f18ca8c11ef0已读，退出1**：archive的Rust fixture mkdir用pid+nanos，线程时钟碰撞AlreadyExists（axiom_archive.rs约113行），Rust4过1失败；Node归档文件整体提前退出，汇总57项56过1失败，不能认为后续归档通过。**立即修fixture加入AtomicUsize序号，再重跑全Node**。日志/tmp/axiom-cleanup-round5-node.log。第五轮tsc退出0（/tmp/axiom-cleanup-round5-types.log为空）。此后尚未修源码。

### 审查与在途任务

- task5c2196b5-f856-49ab-bee9-ffddc8988c97/result4faf452b-da49-4992-bb44-c57b04a9d7d2已读：Linux接线无新增P0/P1；Mac native+archive16项+Rust3项过；建议arm64样本/最终binary入口测试均已按上文补。日志/tmp/axiom-ci-audit.L5xoPh/tests.log。该审查早于最新恢复/原子发布修改。
- 归档安全审查task071d58a1-fd28-4722-a03c-86c88aae55c3两次失败（resultf7dbc5e9-918e-4d25-ace0-d0717208b77a、bb7f5474-4802-475e-a6db-76ecf2bbd534），工具报模型请求被cybersecurity自动标记，无可靠报告；不得标复审通过。主代理手工继续检查并修复恢复竞态，未再重派。
- **唯一仍在途task7eb8e925-d5fd-49d3-a0d1-6f9ea6b75dd1**：只读复核axiom_bundled原子发布各平台分支、desktop.yml YAML+每个bash run块，尚未通知完成。**冻结这两个文件直至结果收取**；其余测试已结束可改。不要轮询，收到通知用read_result。

### 下一步与离线工具扩展

1. 修axiom_archive.rs测试fixture序号并重跑Node回归；仅测试改动不影响生产Cargo证据，但下一次generate会同步测试源码。收取唯一在途审查，按需修与重跑。
2. 正在推进原目标剩余离线维护：task38be58b5-f13b-49ec-948d-a72a20fc2095/resultce4430a6-0fe4-4fb4-a67e-b7a4b8099877已读，确认是可开发工作，不是等待用户授权。**MEMORY已新增“实现RTK独立离线维护”进行中，但尚未写产品代码。**最小首期RTK：抽rtk.ts卸载核心为rtk-removal.ts（配置revision+托管目录校验+removalPending，在线离线共用）；新tool-maintenance.ts无副作用入口，esbuild打包纯Node闭包为模板tool-maintenance.mjs；桥在后台停机仅RTK路由独立宿主，其他明确阻塞。
3. RTK当前构造立即清理原文/统计/旧版本+timer，不能直接实例化。rtk.ts约125行remove闭包可抽取，rtk-config.ts提供读写与路径，managed-removal.ts提供校验/删除。offline宿主必须长持serviceAdmission SQLite写锁+service-startup.sqlite token/pid预约，预约后复核service-control.json PID确实退出；后台启动和安装不能并行。任何未知进程归属/安装事务/残缺状态应拒绝。在线assertToolProcessesStopped会recoverProcessOwner；离线可先保守拒绝所有未核实.axiom-command-*.json，而不加载整个有副作用服务。读取状态不清数据；卸载继续保存job.json终态供UI复核，保留过滤设置/统计/原文。
4. `axiom_service.rs axiom_cleanup`当前CONTROL锁内run('status')后强制running，否则拒绝；Node来源installation_paths(true)，需要离线路由使用runtime_node fallback，并由宿主独立复核停机。Rust仍stdin有界JSON、25s子进程超时。新宿主只固定RTK get/uninstall请求，不接受任意路径/命令，严格revision/confirm。运行时缺Node22.19/SQLite属于真正阻塞，不联网下载。
5. `tool-cleanup.mjs`顶层CLI有import.meta.url===argv1的自启动代码，若被bundle进宿主可能误执行，**不要直接把整个模块import到宿主**；可抽纯白名单模块或宿主自有最小验证。esbuild已作为Vite依赖可用，编译入口不要引Pi SDK/启动后台。
6. 当前desktop-cleanup.ts预览多为通用文字；可在离线状态中扩展实际路径列表，后台在线版本仍需实际旧版本/残留列表。其他工具离线（OpenCLI/REA/代理/资源MCP）依赖更大，但仍是后续有效目标，不能因RTK首期完成就宣称全部完成。未知旧目录需显式选择，公共npm缓存不能整体删；Windows真实执行与Linux runner仍等待平台环境。

## 批注处理结果

1. **名称更正：已处理。** Hi 更正为 Pi，MSP 更正为 MCP；Pi 覆盖终端安装与应用内依赖，MCP 按实际安装来源及作用范围处理。原方案中的名称待确认项关闭。
2. **编译内置默认提示：已处理。** 用户明确“不用管”，本次不处理该部分默认提示，也不因其物理删除而重构发布方式。该决定不影响独立安装组件、MCP 及残留清理的推进，其他未批注要求保持原方案。

本次批注消除了此前的范围阻塞，无需再次确认这两项；产品卸载执行仍需落实逐项预览、确认、归属与占用核验、删除及复扫。用户确认的是产品功能范围，不是授权本轮直接卸载本机安装。
