# 下载维护实现的验证记录

本记录对应工作区中通用下载维护组件的实现，不表示发布、安装器签名或外网真实安装已完成。使用方式与行为约定见[下载与维护任务](download-maintenance.md)。验证使用独立源码和依赖副本；原失败、修复后的结果与跳过项分别保留。

## 实现范围

维护区与任务中心覆盖应用管理的工具、资源包、字体、首次安装及桌面更新，统一显示执行阶段、真实传输字节与速度、时间预算、取消能力和持久历史。已接入 OpenCLI、REA 及托管引擎、RTK、代理内核与导入组件、Resources 的 npm/Git/Pi/MCP/技能维护，以及桌面系统安装和 Pi 更新。

进程监督与父事务分别约束“命令已经退出”和“配置及任务记录已经提交”。未能证明退出、目录身份变化、引用尚未撤销或持久化失败时，保留相关文件和记录。OpenCLI/REA 的中断核实绑定原操作编号。配置保存采用局部合并与必要锁，避免一个资源的操作覆盖其他资源的提交。

## 最新针对性验证

Linux 配置 rename 后目录 fsync 失败造成的卸载收尾缺口已修复，原 root/nobody 各 6/8、exit 1 的[故障报告](../review-artifacts/builtin-fsync-linux-20261024-0108/REPORT.txt)保留。修复通过独立持久卸载意图保留清理入口，并区分安装配置已发布与同步成功，避免后续同步失败时删除已被引用的候选。Linux 双身份故障复验、Windows 完整物理依赖隔离复验、受影响原套件和最终包核验均已完成并通过。

各行是独立测试范围，存在交叉覆盖，不相加为总覆盖率。

| 范围 | 结果 | 证据与边界 |
| --- | --- | --- |
| OpenCLI/REA 半删除重试、目录替换、诊断脱敏及历史写入故障 | 26/26 | [真实服务路径专项](../review-artifacts/builtin-final-recheck-90f210a58a2a4d169e70c794199a7fe3/commands-and-results.txt)；Windows、离线 |
| Linux 卸载恢复、初始 pending 同步失败、缺失路径与新 inode 保护 | root/nobody 各 20/20，均 exit 0 | [卸载报告](../review-artifacts/builtin-removal-linux-20261024-0124/REPORT.txt)；独立冻结、真实 tsc 生成 JS，原 6/8 失败保留；该冻结早于安装回调及最终 OpenCLI reload |
| 最终 Linux 安装发布前后故障与同实例重试 | root/nobody 主轮各 6 项通过，组件定向补测各 2/2、exit 0 | [最终报告](../review-artifacts/builtin-publish-linux-20261024-0130/REPORT.txt)；主轮组件因缺少 REA 6.7.0 夹具基线未进入故障点，原 exit 1 保留；补齐前置后仅重跑组件两项。最终源含 reload，文件同步失败清未发布候选、目录同步失败保引用候选且任务 failed |
| 最终 Windows 卸载恢复、同实例重试与安装发布故障，完整物理依赖隔离 | 26/26，三个命令 exit 0，0 跳过 | [独立物理副本复验](F:/axiom-isolated-reviews/physical-final-586d3a18a59244309375dd84968d5160/evidence/commands-and-results.txt)；原同实例 6 项、卸载 11 项、安装故障 9 项逐字未改；62,571 个输入前后 SHA 不变，无链接或硬链接；2,213 个实际文件模块全部来自独立仓库，仓库外模块负向检查按预期拒绝 |
| 较早 Windows 相同 26 项行为验证 | 26/26，三个命令 exit 0 | [原行为复验](../review-artifacts/builtin-publication-final-bd95374697bd4049b04345b2d8280bfb/commands-and-results.txt)；该轮依赖通过 junction 复用，仅作为行为证据保留，不作为完整物理依赖隔离证据；已由上一行独立补验覆盖 |
| 配置文件 fsync 失败及提交顺序 | 4/4 | [fsync 专项](../review-artifacts/builtin-fsync-recheck-e67c2360dfee4872bf8a560ee99a1cfb/commands-and-results.txt)；验证失败不 rename、不提前忘记原目录身份；不等于断电保证 |
| 最终卸载意图、安装发布、同实例重试变化后的原套件 | 依次 52/52、45/45、17/17，均 exit 0 | [三轮版本审计](../review-artifacts/opencli-final-freeze-20261024-0130/three-run-audit.json)；每轮重新冻结，按变化分别运行原 6 组、安装相关 5 组、OpenCLI 2 组，不相加为总用例数 |
| 更早 OpenCLI、REA、代理变化后的 11 个原测试文件 | 77 通过、7 跳过、0 失败 | [原套件日志](../review-artifacts/config-gates-freeze-20261024-0109/original-tests.log)；跳过项需要 Linux 或真实 mihomo/Xray/importer |
| 严格历史校验与 backend 历史同步后的 Resources 五原文件 | 68/68，0 跳过、exit 0 | [真实回归结果](F:/axiom-resources-audit-20261024T011442078/results.json)；63,005 文件 SHA 不变，fake npm 与注入执行器，无联网安装 |
| MCP 诊断截断的新展示约定 | 3/3 | [严格探针](../review-artifacts/mcp-freeze-20261024-0058/mcp-strict-contract.log)；后续完整行保留，已失去前缀的不完整巨行舍弃 |
| 核实交互、焦点恢复、错误去重 | 30/30，焦点跟踪通过 | [Chrome 结果](../review-artifacts/chrome-retest-20261024-0057/browser-results.json)；真实组件、mock transport |
| 不支持平台的直接维护入口 | 28/28 | [平台界面结果](../review-artifacts/chrome-retest-20261024-0057/darwin-v3-results.json)；Windows Chrome 模拟 Darwin 状态 |
| 代理间接识别/启动入口限制与正常平台请求 | 13/13 | [Chrome 定向结果](../review-artifacts/proxy-final-20261024-0105/browser-results.json)；暗亮 320/390 提示可读、无横向溢出 |
| 后台平台限制及原 marker 夹具复现 | 6/6；修正后 maintenance 原套件 7/7 | [结果](C:/Users/dane/AppData/Local/Temp/axiom-proxy-marker-reverify-9d0534b19d7f4512966ff732aa9f19a2/proxy-marker-probes-final.log)；不支持平台在 fetch、进程启动及订阅读取前拒绝 |
| 历史部分损坏、RTK 自动清理及桌面 HTTP 故障 | 27/27 | [直接模块专项](C:/Users/dane/AppData/Local/Temp/axiom-maintenance-reverify-132126fe273145d2a33fea3fd6e96b07/probes-corrected.log) |
| 实际 payload 提取后的桌面 HTTP | 21/21 | [提取模块专项](C:/Users/dane/AppData/Local/Temp/axiom-maintenance-reverify-132126fe273145d2a33fea3fd6e96b07/payload-probes.log)；重试、Retry-After、取消、动态预算、短流与终态分类 |
| 桌面 HTTP 变化影响的 3 个原测试文件 | 38 通过、1 跳过、0 失败 | [第十一轮日志](F:/axiom-updater-audit-20261023T231817656/round11-20261024T005654325/affected-tests.log)；Windows npm symlink 布局用例跳过 |
| 初始 Windows 安装脚本提取及 handoff | 11 场景通过 | [PS5.1 验证](C:/Users/dane/AppData/Local/Temp/axiom-extract-fix-1a109eb1-a416-415a-9242-6bd7a82cfa68/verification.json)；root 最长 300、payload 文件路径最长 401，中文/空格/单引号、相对路径及故障阻断；安装和启动使用 stub |
| Rust 桌面逻辑 | 42/42，0 ignored | [构建与测试报告](F:/axiom-desktop-final-a9d618e29ade4d6eac72aab056bd638f/report.md)；包含 8 项 setup 测试 |

Windows 最终补验物理复制根目录 30,936 个依赖文件和 app 的 31,154 个依赖文件，清空 `NODE_PATH`，按真实路径限制模块解析与加载，禁止仓库外祖先依赖或全局模块补齐。宿主 Node、Windows 与系统 DLL 不在此依赖隔离范围内。安装发布后故障是在真实 rename 和回调之后的临时文件清理处注入，不是 Windows 目录 fsync 或断电测试。

此前 Windows Job/HANDLE、Linux guardian、服务恢复、Resources 配置并发、首次安装历史、字体下载及多宽度界面的专项证据继续保留。以上最新测试没有替代真实操作系统安装、真实外部引擎运行或发布验证。

## 构建与依赖

最终新包已包含持久卸载意图、安装发布边界及 OpenCLI 失败后刷新配置的修复。应用构建、正常 `npm pack` 的 prepare/bootstrap/native/build、前后 bootstrap 生成检查和解包后 627 文件核对均通过。服务端产物与冻结源码的 ESM 转译一致；179 个客户端文件经实际 Vite 构建并与包内产物逐项比对。918 个冻结输入在测试期间不变，最终核对与主树一致。详见[最终发行包报告](../review-artifacts/final-candidate-5d8d5035194a443a84f20f1aaadd3ade/report.md)。

发行包为 [cosyeezz-axiom2-0.4.1.tgz](../review-artifacts/final-candidate-5d8d5035194a443a84f20f1aaadd3ade/pack/cosyeezz-axiom2-0.4.1.tgz)，3,479,398 字节，SHA256：

```text
4b80099b596b13ca7522c9ec621f42068810500fcca3cf77dbee33aa5d56fafb
```

在全新隔离目录实际执行 `npm ci --offline --ignore-scripts --no-audit --no-fund` 后，`npm ls --all` 与直接依赖检查均通过。325 个本平台包、506 条依赖边、22 项直接声明一致，69 项未安装条目均为其他平台可选依赖。限制模块加载范围后仍可加载 Koffi，并完成真实 PID API 和命令租约存活/关闭验证；没有从祖先目录补齐缺项。见[真实 ci 树审计](../review-artifacts/ci-verify-435c7189e81a4f00bb69df5e228ad287/report.md)。

工作区根目录原缺 10 项依赖，已由同样的离线、禁安装脚本方式补齐；根目录 `npm ls --depth=0` 和本地 Koffi PID API 均通过。原有缺项结果仍保留，见[当前根依赖记录](../review-artifacts/root-dependencies-20261024-final/npm-ls.json.utf8)。

正式构建入口生成 Windows x64 **debug profile** 的 [Axiom2.exe](F:/axiom-desktop-final-a9d618e29ade4d6eac72aab056bd638f/repo/app/Axiom2.exe) 和 [Axiom2.msi](F:/axiom-desktop-final-a9d618e29ade4d6eac72aab056bd638f/repo/app/Axiom2.msi)。这两个产物未签名、未装机、未发布。桌面内嵌 Connect 启动页，工作台维护页面由后台应用包提供，应配套使用本轮后台包。

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| Axiom2.exe | 33,621,504 | `3FDF3C3A45AE1772D1E6982955E47B236F59F8FB9EF42C8058B9F9286B392481` |
| Axiom2.msi | 10,526,720 | `E086F354642620DE27658CD369468985E15A7E6B05B4F4124BBAFBB4DD3C0142` |

初始安装脚本修复只改变生成器与 `install.ps1`；两者不在发行 tgz 内，也不改变桌面内嵌运行时。后续后台恢复修复已纳入上述新包，桌面 Connect 与运行时未变。共享 payload SHA256 仍为：

```text
C2DEEF3164B0139EC6573C7AAEC5FD9F64D124563E96033A76AB43DEEE40BB44
```

## 保留的失败与适用限制

- Linux 最终发布主轮因组件夹具缺少 REA 6.7.0 基线，root/nobody 各有两项未进入故障注入、exit 1；补齐合法离线基线后，两身份各 2/2、exit 0。原版本门槛及保护断言保持不变，主轮失败没有改记为通过。
- Windows 卸载意图初轮 35/37，两个 OpenCLI 同实例重试因快照旧 revision 失败。失败日志保留；补上失败收尾重读配置后，原 6 项同实例探针逐字节未改并全部通过。
- MCP 原探针仍有一项旧断言失败：它要求没有换行的 10 万字符日志保留末尾 `ERR_END`。新的诊断展示为避免凭据前缀已被裁掉时泄漏秘密，会舍弃整条不完整行；独立新约定探针通过，原失败没有改记为通过。原始有界日志的 tail 内容保持不变。
- 原 maintenance 夹具的第二次运行故意触发结构化输出超限，同时再次截断第一次已成功写入的 marker，产生偶发空文件。已独立复现该竞争窗口，修正夹具的 marker 归属，并保留全部输出长度、超限原因及成功内容断言。
- 早期 payload 过期、PowerShell BOM 和初始长路径提取失败均保留；最新生成检查、独立运行及相应产物已通过。
- macOS 尚无本实现要求的可靠维护进程监督；有关托管操作明确停用，保留可用的配置和清理入口。模拟 Darwin 状态的测试不等于 macOS 实机验证。
- 未验证正式 arm64 构建、真实外网安装、安装器装机与签名、所有真实外部引擎，也不承诺任意断电或文件系统故障下都能完成持久化。测试中的 skip 及 stub 均不计为真实安装成功。
