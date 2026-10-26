# 服务与更新：按钮覆盖与实机缺口（2026-10-25，手测反馈修订）

**结论：没有完成“每个按钮的真实客户端验收”。** 第一版报告把分组回归写得过宽，尤其没有点击覆盖 Pi 卸载页面；用户首次点击“预览 Pi 卸载”即暴露正常空安装误报。此前构建成功、模拟桥接通过、Unix 用例在 Windows 跳过都不能替代原生验收。本文修正覆盖表述，不抹去前轮实际测试记录。

## 证据级别

- **U**：单元/模块回归，命令、网络或安装由 fixture 注入。
- **B**：Chromium 页面点击，IPC 返回值为合成数据，不是 WebView2/Tauri。
- **H**：真实 production updater CLI/worker、真实 npm root、Windows 进程监督；只使用临时隔离 data/prefix，页面的传输仍是 HTTP 测试适配器。
- **N**：真实客户端 WebView2 + Tauri IPC；本轮已执行下面明确链接的有限分支，**仍未完成每个按钮及全部异常分支验收**。
- **S**：真实系统安装/升级/停止/卸载；**没有替用户执行**。
- “缺口”表示没有足够证据认定该按钮及其异常分支通过；不是默认通过。一个按钮的正常分支通过，不表示它所有空态、超时、权限与失败组合已覆盖。

最新证据：

- [U：Pi 相关 36 项，28 通过、8 Windows skip、0 失败][U]，exit 0。全部 7 个原 Pi 卸载用例在 Windows skip，不能计为 Windows 卸载通过。
- [H：冻结 r2 源码的真实 helper + Pi 页面空态][H]，exit 0：读取无任务、真实 npm 预览、重读、重复预览、不同任务 ID、token null、prefix 未创建、监督 owner 释放；深浅主题 × 360/1200 共 4 图。没有运行产品 EXE、安装或卸载。
- [B：Pi 页面 7 组按钮场景][P]，exit 0：确认/返回/勾选、单次提交、合成响应丢失不重放、其他类型任务、失败状态、取消/延长/核实的 action/id 绑定；4 幅确认截图。
- [B：环境扫描及工具确认 24 场景][E]，exit 0，6 图；其中 native bridge 明确是内存 fixture。
- [前轮分组证据及修复说明][R]，保持其时间与平台限定。相关 `package-removal.check.ts` 本轮未运行，不计通过。

## 当前真实原生结果

**历史故障及 R4 修后结果：** 原生只读取消补测曾出现缓存原子替换 `EBUSY`，task `cdf4ab3f-8048-4035-a2ac-ba5130869c14` failed；[失败现场][N8F] 保留。只读 SQLite 证明该次没有取消受理记录，不能称“已受理取消被吞掉”。新增有限 Windows rename 重试/取消前检查/原生字符串错误归一化并补齐资源闭包后，R4 已两轮真实验证取消与延时：[真实停止回执][N8C]、[受理/终态与 UI 观察][N8R]。一次任务先结束未受理，明确不算取消通过。原生受影响页面、预算和进程重启也已重跑；仍不代表所有安装、卸载及全部异常条件通过。

- 首次独立 ClickAudit 真实点击复现宿主无响应和空安装记录误报。布局延后/合并、相同 bounds 缓存和 ENOENT 提示修复后，另建 `local.axiom2.desktop.clickaudit.r2` 生产包，未使用 test-instance 或 IPC 替身。
- [N1]：真实主题深浅切换、状态刷新、更新展开、记录入口 5 步；原生记录成功读取，Pi-refresh 真实约 5 秒完成，空安装提示正确。新宿主 Responding=True，旧挂起现场原样保留。
- [N2]：早轮 52 项、最终 R4 51 项真实 UI 流程检查完成（本轮任务记录入口已开，少一条打开步骤），覆盖下表注明的导航、端口、空态和只读扫描。首轮脚本将切回本地后正常 Pi-refresh 的临时 disabled 误作失败；失败证据保留，修等待后重跑通过。不是 52 个功能的所有分支都通过。Windows 预览安全拒绝仅验证保护生效，不算卸载通过。
- [N3]：真实 Win32 连续缩放、最小化恢复与恢复原 bounds 共 6 步，每步主题原生 IPC、Responding、WebView/OS client bounds 对齐与窄屏无横向溢出通过；不是合成 viewport resize。未验证换屏 DPI 和工作台切换。
- [N4]：19 项真实刷新/网络检查、Pi 确认取消/Escape、预算模板/保存及 reload 持久化、RTK 只读预览/返回。实际最新 Axiom2 0.4.17、Pi 1.4.0；没有安装或删除。其他工具因无后台而未具备预览条件。
- [N5]：19 项本地/远程准备、重新检测/下一步/返回、setup 预算实际 reload/恢复、日志目录真实 Explorer 打开及缺失 Pi 路径拒绝。路径图标须先悬停显示；首次脚本未悬停的点击失败保留，按自然交互修脚本后通过，未使用 force click。
- [N6]：三官方下载地址和现有 Tailscale 打开入口已真实点击。首次仅查前台窗口无法验证；[Chrome 原生只读补证][N6C] 显示三个目标页面和点击约 120ms 的时间关联，排除旧同域标签，没有修改或关闭其他标签。Tailscale GUI 可见性仍未验证。
- [N7]：最终 R4 设置 update/setup 预算为33/34秒，核完整任务/监督回执后正常关闭 PID37060（exit0），以同一真实EXE/data/profile启动38876，读回33/34，再恢复两者30秒；核4任务及清理回执，正常退出0、profile的WebView2全退。早轮 R2 过早连接 target 的脚本失败过程保留，等待修正后 R4 完整一次通过。未杀进程/删锁。
- 剪贴板保护审查确认旧 guard 不能保证多格式保真或并发安全；**未点击复制图标**，等待独立 Windows 会话，不冒险覆盖用户剪贴板。浏览器仍记录未连接后台时 `ws://tauri.localhost/ws` 拒绝连接，无 pageerror；不隐去该未消除现象。

## 连接与服务控制

对应 [Connect](../app/src/client/pages/Connect.tsx)、[DeviceSelect](../app/src/client/pages/DeviceSelect.tsx)、[RemoteConnect](../app/src/client/pages/RemoteConnect.tsx)。

| 按钮/交互 | 已有证据 | 明确未验证项 |
|---|---|---|
| 服务与更新（从工作台返回） | 前轮 B 导航 | N，真实工作台/控制窗口往返 |
| 连接设备下拉、本机/已发现设备/手动输入 | 前轮 B；[N2] 本机/手动输入/返回本机 | 已发现远程设备及真实跨机网络 |
| 刷新设备 | 前轮 B；[N2] 真实设备读取入口及终态 | 真实离线与重新上线 |
| 连接工作台 | 前轮 B；[N2] 本地 0/65536/abc、远程非法端口校验，本地临时关闭端口真实拒绝 | 真实成功工作台、超时与断网重连组合 |
| 检查状态 / 重新读取服务状态 | 前轮 B；[N1] 空安装真实状态刷新 | active/unmanaged/stopping 等完整组合、真实读取超时 |
| 启动服务 | 前轮 B 与模块测试 | S、外部进程/端口冲突的真实状态收敛 |
| 关闭服务 / 取消启动 | 前轮 B 打开确认 | S、真实子任务退出 |
| 继续运行 | 前轮 B 对话框回归 | N，不停止后台的真实确认 |
| 确认关闭服务 | 前轮 B | S，不替用户停止现有后台 |
| 安装服务（展开准备） | 前轮 B 导航 | 首次无 Node/npm/不可写环境组合 |
| 打开工作台 | 前轮 B | N、真实服务健康后导航 |
| 查看安装记录（恢复提示入口） | 前轮 B 恢复区定位 | 完整任务记录入口/无历史/读取失败串联 |
| 主题切换、各折叠区展开 | 前轮 B；[N1][N2] 真实主题/折叠；[N3] OS 缩放/最小化后主题 IPC | 工作台主题及换屏 DPI；折叠本身不构成后端验收 |

## 安装与准备

对应 [SetupWizard](../app/src/client/pages/SetupWizard.tsx)、[StartupControls](../app/src/client/pages/StartupControls.tsx)。

| 按钮/交互 | 已有证据 | 明确未验证项 |
|---|---|---|
| 运行环境 / 后台服务 / 连接工作台步骤导航 | 前轮 B；[N2] 三步骤真实切换及返回后台 | 各步骤全部禁用/恢复组合 |
| 连接环境（远程 Tailscale 步骤） | [N5] 真实已安装检测、导航及下一步/返回 | 未安装及离线所有分支 |
| 重新验证环境 | 前轮 B；[N5] 本地 Node/npm 和远程 Tailscale 真实重验 | 无 Node、无 npm、断网、不可写完整组合 |
| 安装 Node.js | 前轮进度 B、真实 PowerShell 包装器 + 假 Node 测试 | S，真实系统安装器 |
| 安装 Tailscale | 源码审查 | B/N/S 未完整覆盖 |
| 打开 Tailscale | [N6] 真实入口返回无错误，现有进程保留 | GUI 是否显示未验证，不冒充应用可见性通过 |
| 下一步（环境/服务） | 前轮 B；[N5] 本地环境至后台、远程网络至连接及返回 | 已安装服务及所有禁用分支 |
| 重新验证服务 | 前轮 B；[N5] 真实缺安装状态重验 | 真实安装注册变化 |
| 安装并启动服务 | 前轮 B 进度；包装器退出码 0/7 实测 | S，真实网络下载安装及启动 |
| 复制 Node.js 安装命令 | 源码审查 | 剪贴板成功/拒绝点击覆盖 |
| 复制 Tailscale 安装命令 | 源码审查 | 同上 |
| 复制一行安装命令 | 源码审查 | 同上 |
| 复制手动安装命令 | 源码审查 | 同上 |
| 复制启动服务命令 | 源码审查 | 同上 |
| 复制开发运行命令 | 源码审查 | 同上 |
| 复制 Node.js / Tailscale / 服务下载地址 | 源码审查 | 三入口分别成功/拒绝 |
| 打开 Node.js / Tailscale / 服务下载地址 | [N6][N6C] 三入口实际点击、默认 Chrome 中三个对应官网页面补证 | 拒绝/离线/默认浏览器不可用分支 |
| 安装任务记录 | [N2] 入口、真实空历史、重新读取及关闭 | 有历史、读取失败及恢复串联 |
| 首次安装下载设置 → 保存设置 | [N4][N5] 真实保存/reload；[N7] 完整宿主进程重启读回34秒并恢复30秒 | 错误组合/断电等未穷举 |
| 重新读取安装进度 | 前轮 B 迟到状态/失败 | N；请求超时后 job:null 的全部组合 |
| 重新核实后台状态 | 前轮恢复 B | 真实中断安装记录核实，未动用户旧锁 |
| 核实退出回执并解除占用 | 17 个隔离回归、最小 Cargo stub 9 项；B 缺证据/成功/ID/防双击 | N；用户真实旧记录未操作；stub 不是正式 Tauri 验收 |
| 确认安装器退出后解除占用 → 取消 | 前轮恢复 B 部分覆盖 | 各系统安装动作完整分支 |
| 我已确认安装器全部退出 | 前轮恢复/实现审查 | N/S，不能由 PID 消失推断进程树退出 |

## 版本与更新

对应 [DesktopUpdates](../app/src/client/pages/DesktopUpdates.tsx)。

| 按钮/交互 | 已有证据 | 明确未验证项 |
|---|---|---|
| 检查更新 | 前轮 U/B；[N4] 真实 GitHub 最新0.4.17 | 首次离线无缓存、缓存后离线、无 npm 等完整组合 |
| 更新后台服务 | 前轮 U 与 B 正常/恢复流程 | S，真实服务切换、会话与端口恢复 |
| 下载客户端更新 | 前轮 U/B；真实检查已执行但未下载 | Waiting：官方0.4.17没有MSI，按钮不显示，不用假包补原生分支 |
| 运行安装器 | 前轮 B 入口、旧版本隐藏及 U 重验 SHA | S；测试脚本中的 recording 替身不等于真实 MSI |
| 打开安装向导 | 前轮 B/recording 级脚本 | 真实 MSI 不自动启动，以免改正式客户端 |
| 恢复旧版本 / 确认恢复 | 后台恢复 U | 该按钮完整 B/N/S 路径未覆盖 |
| 暂不更新（后台/安装器/恢复） | 前轮 B 部分确认框 | 三种分支逐项原生返回不提交 |
| 刷新 Pi 安装状态 | 前轮 U/B；[N4] 真正 npm 空安装刷新终态 | 多来源/损坏/重装资格的完整 N 组合 |
| 检查 Pi 更新 | 前轮 U/B；[N4] 真实 npm 稳定版1.4.0及token | 真实镜像/代理/无 npm/离线各分支 |
| 安装终端 Pi / 确认安装 Pi | 前轮 U/B；[N4] 用真实版本/token打开确认，取消/Escape | 未提交确认安装；S 真实 npm 安装与终端调用未执行 |
| 更新终端 Pi / 确认更新 Pi | 前轮 U/B | S，真实升级 |
| 重新安装终端 Pi | 前轮 U/B 保留修复资格 | S，真实同版本修复 |
| 取消（Pi 更新确认） | [N4] 原生取消/Escape、确认框关闭、焦点返回、不提交 | 已安装升级确认分支 |
| Pi 安装路径复制 / 在文件管理器中显示 | [N5] 实际缺失 Pi 路径拒绝；真实更新日志 Explorer 目录核对 | 复制 Waiting 独立 Windows 会话；已安装 Pi 目录分支 |
| 更新任务记录 | [N1][N2] 入口、真实 Pi task、筛选/选择/详情/重读/来源/关闭 | 无历史/损坏/读取失败及控制动作 |
| 桌面下载与安装超时设置 → 保存设置 | [N4] 模板/0值/保存/reload；[N7] 完整宿主进程重启读回33秒并恢复30秒 | 错误组合/断电等未穷举 |

## Pi 卸载（本轮重点补齐）

对应 [DesktopPiRemoval](../app/src/client/pages/DesktopPiRemoval.tsx)。

| 按钮/交互 | 本轮执行证据 | 边界 |
|---|---|---|
| 预览 Pi 卸载 | [U] + [H] 真实空安装、重复预览不同 task ID；[P] 防双提交；[N2] 真正 Tauri 空预览、无删除入口、prefix 未创建 | 空安装现在成功、token:null，无删除确认；损坏/legacy/npm 错误仍失败；不是宣称其他来源也未安装 |
| 读取清理任务 | [H] 无任务/预览重读；[P] 其他任务/响应丢失；[N2] 无相关任务及真实空预览后重读 | 不复用其他类型任务旧 token；已安装及异常仍未完整 N 验收 |
| 卸载此终端 Pi | [P] 合成已安装预览打开确认 | Windows 包装器归属限制未解除，不能由合成可点击推断真实支持 |
| 会话关闭与范围确认勾选框 | [P] 初始未选、勾选、撤回、重开清空 | 不自动检测或结束外部终端会话 |
| 返回 | [P] 返回不提交、确认框移除、重新打开未勾选 | N 未验收 |
| 确认卸载 | [P] token/confirm/sessionsClosed 精确 payload、双点击仅一次、成功关闭确认、合成响应丢失不重放 | 没有实际删除；原 7 个 POSIX 卸载用例 Windows skip |
| 取消任务 | [P] `cancel`/当前 id 精确绑定、取消终态停止轮询 | 仅合成执行端，不代表真实树已退出 |
| 延长本次时限 | [P] `extend`/id/budgets 精确绑定、不重新预览或重启 | 原生监督器延时未由此测试 |
| 核实中断任务 | [P] `reconcile`/id 精确绑定、不开新卸载任务 | 真实退出证据由独立恢复测试限定，N 未串联 |
| 查看任务详情 / 时限模板 | 前轮通用 B；本轮展开时限详情修改秒数 | Pi 内全部模板键盘/校验组合未穷举 |

## 其他清理与扫描

对应 [DesktopEnvironment](../app/src/client/pages/DesktopEnvironment.tsx)、[DesktopToolCleanup](../app/src/client/pages/DesktopToolCleanup.tsx)、[DesktopServiceRemoval](../app/src/client/pages/DesktopServiceRemoval.tsx)、[DesktopArchiveCleanup](../app/src/client/pages/DesktopArchiveCleanup.tsx)。

| 按钮/交互 | 已有证据 | 明确未验证项 |
|---|---|---|
| 扫描安装与残留 / 重新扫描 | [E] B；[N2] 真实已知目录扫描、11 类项目及命令/残留/限制展开 | 重扫、所有真实安装来源/权限/部分失败组合 |
| 只读扫描指定目录 | [E] B/U；[N2] 实际不存在路径只读扫描且不创建 | 真实权限/链接组合及 Windows symlink EPERM 未验收 |
| 读取可卸载项目 | [E] B；[N2] 真正离线生产 helper 项目读取 | 每行预览/返回及各 family 异常仍需分别执行 |
| 查看卸载范围 | [E] B 范围/修订/风险确认 | 每种真实工具 N/S |
| 查看数据清理范围 | [E] B RTK/下载缓存等部分流程 | 全 family 分别确认 |
| 查看只读范围 / 当前不可自动清理 | [E] B；[N4] 真实 RTK 离线范围和保留清单、返回 | 不代表提供删除能力；其他 family 未具备运行条件 |
| MCP 凭据清理勾选 | 实现审查 | 单独 B/N/S 未完整覆盖，不动真实凭据 |
| 工具确认 → 返回 | [E] B；[N4] RTK真正离线只读预览及返回 | 其他已安装工具逐项返回与修订变化 |
| 确认清理所列范围 | [E] B 风险摘要/防双提交/响应丢失不重放 | 不执行真实卸载；原生全链路未验收 |
| 重新核实与扫描 | [E] B 结果复读与部分失败 | 重启后 pending 持久化完整组合 |
| 关闭结果，重新选择项目 | [E] B | 所有 family 逐项覆盖 |
| 预览后台卸载 | 前轮 [E]/U；[N2] Windows 真实安全拒绝及任务重读 | Windows 真实自动卸载不支持，拒绝不是卸载通过 |
| 读取后台清理任务 | [N2] Windows保护拒绝预览后实际重读 | 无任务/读取异常/实装完整组合 |
| 卸载此后台 | 前轮 [E] 合成确认流程 | S 未执行 |
| 继续清理后台残留 | 实现与后端部分 U | B/N 的 resume 路径缺口 |
| 后台范围勾选 / 确认卸载后台 | 前轮 [E] B 禁用/提交/防重复 | Windows 安全限制不解除 |
| 后台确认 → 返回 | 实现审查 | 独立点击断言缺口 |
| 后台任务取消 / 延时 / 核实 | 通用控制 B/U 不等于本页 | 本页 action/id 的独立串联缺口 |
| 预览下载归档 | 前轮 [E]/U；[N2] 真实预览及任务重读，未删除 | 空列表/读失败完整组合；Windows 不提供可删目标 |
| 读取归档清理任务 | [N2] 真实只读预览后的任务重读 | 无任务/读异常/其他平台完整组合 |
| 清理此归档 | 前轮 [E] B 合成目标选择 | Windows 真实自动删除不支持 |
| 确认清理归档 | 前轮 [E] B 防重复与后端拒绝 U | S 不执行；归档身份/锁/其他任务保护不能取消 |
| 归档确认 → 返回 | 实现审查 | 独立点击断言缺口 |
| 归档任务取消 / 延时 / 核实 | 通用控制 B/U 不等于本页 | 本页 action/id 的独立串联缺口 |

## 两个任务记录中心与共用控制

对应 [DesktopTaskCenter](../app/src/client/maintenance/DesktopTaskCenter.tsx)、[TaskCenter](../app/src/client/maintenance/TaskCenter.tsx)、[MaintenanceView](../app/src/client/maintenance/MaintenanceView.tsx)。

| 按钮/交互 | 已有证据 | 缺口 |
|---|---|---|
| 关闭下载与维护 | 前轮 B；[N2] setup空记录及update有记录两个真实入口关闭 | 任务运行/读取失败等组合 |
| 全部/进行中/需处理/已结束筛选 | 前轮 B；[N2] update真实历史四筛选；setup空历史 | 损坏历史/不同资源运行态完整组合 |
| 任务列表选择 | 前轮 B；[N2] update真实任务选择及详情 | 历史损坏/读取失败与当前任务合并 |
| 来源页面 | 前轮 B；[N2] update真实来源返回，不重放 | setup实装任务返回/焦点所有组合 |
| 重新读取 | U/B；[N2] 两个真实history入口重读 | 读取失败、关闭后停止轮询等时序组合 |
| 取消任务 | 通用 B/U；[P]；[N8C][N8R] 真正只读任务取消受理/终态/监督回执 | 不能替代真实安装/卸载或全部历史入口的取消；错过窗口不算通过 |
| 核实中断任务 | 独立恢复 U、Pi [P] | 历史页当前 ID 门控的 N 串联 |
| 延长本次时限 / 保存设置 | 通用 B/U/[P]；[N8R] 同真实task总时限1200→1201秒并成功；[N4][N7] 默认预算持久化 | 其余安装/卸载阶段和错误组合；未将延时当重新运行 |
| 时限模板标准/网络较慢/大文件、自定义数值 | 前轮通用 B 键盘/指针、菜单边界与校验 | 各执行端实际应用预算 N |

## 不能解除的安全限制

1. Windows 托管后台自动卸载、带 npm 包装器的常规 Pi 自动卸载、下载归档自动删除仍不支持或明确拒绝；“有按钮/已预览”不等于可删除。
2. 真实旧 APPDATA 的中断 owner 记录保留，未清锁、未重装、未停服。
3. 只接受监督器的完整身份和退出回执；不以 PID 消失代替树退出。
4. 第一版已交付 ZIP 不包含 Pi 空安装及后续原生修复；历史 NativeR2 含后来发现的原子写问题，R3 缺依赖从未运行。最终候选为独立 `clickaudit.r4`，不需关闭正式/旧 ServicesReview 窗口；相同 R4 仍单例，验收所用 R4 已正常退出。最终 ZIP 交付以审计报告中的验证状态为准。

[U]: ../app/test-results/services-audit/handtest-pi-empty/backend-regression.log
[H]: ../app/test-results/services-audit/handtest-pi-empty/frozen-native-helper/result.json
[P]: ../app/test-results/services-audit/handtest-pi-empty/frozen-pi-buttons/result.json
[E]: ../app/test-results/services-audit/handtest-pi-empty/environment-fixture-r2.log
[R]: services-updates-audit-20261025.md
[N1]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-JVCJRE/initial-clicks/result.json
[N2]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-JVCJRE/controls-clicks-Wi9Gm6/final.json
[N3]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-JVCJRE/layout-clicks-poWHjp/result.json
[N4]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-JVCJRE/updates-clicks-xeZcDN/result.json
[N5]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-KlXKKk/preparation-clicks-nGAD4B/result.json
[N6]: ../artifacts/native-click-audit-20261025-layout-r2/native-session-m0zF1T/open-links-CL0BxX/result.json
[N6C]: ../artifacts/native-click-audit-20261025-layout-r2/native-session-m0zF1T/open-links-CL0BxX/native-chrome-url-observation.json
[N7]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-KlXKKk/restart-clicks-gykwPf/result.json
[N8F]: ../artifacts/native-click-audit-20261025-layout-r2/native-session-j83d7b/task-controls-s6LB2w/failure.json
[N8C]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-EJqeZI/task-controls-lT3vPH/final.json
[N8R]: ../artifacts/native-click-audit-20261025-atomic-r4/native-session-JVCJRE/task-controls-QkkARv/final.json
