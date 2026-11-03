# 下一自然官方入口：独立只读评审

## 结论
建议下一小case是**一次自然官方模型目录入口**，不是重跑03，也不是生成请求。候选为已由help证明语法的 `kiro-cli chat --list-models --format json`；可保留显式 `--v3`，但该flag不证明目录走KAS。取消fake program/server/preload overrides，使用自然官方链，不执行提取bundle，不把CLI作为Axiom代发桥，不将旧fake-only tap改标签。
这是计划，不是就绪runner或执行授权。当前材料不足以给出已验证的最小Mach/egress allowlist；前提未满足必须BLOCKED，不能启动再试探放宽。此次官方/auth/network/model执行均为0。

## 已有证据
- request-sender-probe-03/SUMMARY.md，Actual one-shot result / Normal state：六组件三时点共18次lstat稳定；官方held child实际-9，约0.563s，73B received prefix命中Opening browser，guard kill/reap，无C trace且未drain。case永久consumed。
- 排除的只是已查时点目录缺失/类型或身份不合，不证明credential服务可访问、refresh可达或账户有问题。接受用户两端已正常个人登录，不索截图/确认/重新登录。network/mach/新Keychain lookup拒绝可能混淆，但未确诊；不猜具体服务名为依赖。
- request-sender-probe-01/SUMMARY.md，Directly useful parameters：list仅语法已知，未执行。v3-kas-review-01/entry-model-evidence.txt，byte3653252/line2242是KAS control-plane ListAvailableModels静态实现；byte14279000/line17354存在缓存/刷新。deepseek-3.2唯一literal byte2155716属于no-vision set，非可用性目录。
- v3-command-review-01/environment/REPORT.md，Conclusion / What is and is not established：最终环境合并与NODE_OPTIONS继承UNKNOWN。initial/REPORT.md的stdio/WS仅静态构造，不是自然spawn或preload命中。
- v3-kas-review-01/dispatch-report.md，byte8451108/line5153存在feature-gated API分支；都非当前实发证据。native list可能绕过KAS，即使传--v3也不能宣称两个catalog相同。

## 可反驳假设：natural-catalog04（待另行授权）
H：现有个人登录的自然官方入口，在事先证据支持的普通权限下，一次list能非交互返回完整可验证目录，可安全投影是否存在精确modelId `deepseek-3.2`，无需prompt/生成。
相对03最小必要差异：从fake KAS选择测试改为官方list；删除实验fake executable/server/preload替换；仅在独立审查后授予有证据支持的credential-service及catalog/必要refresh权限。保留normal HOME/state、own CWD/TMP、身份绑定、隐私投影与interactive guard。多个差异不能作单因素归因；不是03重试。
反证/不支持：interactive marker、明确目录失败、完整有效目录不含精确ID。cap/timeout/schema未知/权限阻断仅是失败或不可判定，不能当模型不可用。

## 必要permissions及前提
1. 绑定实际安装官方路径、版本、架构与文件SHA；旧2.35.2不是live loaded-image证据。版本变更则静态结果不自动适用。只查公共程序身份，不打开账户存储。worker ownHOME/minenv，官方normal HOME；删除仅实验override，不读用户完整env/settings来恢复状态机。
2. 允许官方opaque使用既有个人凭据、普通state/lock写入；agent不stat/open/read credential DB，不查询Keychain item内容，不复制token/CLI凭据给Axiom。Axiom维持独立个人登录，本case不运行它。agent secret读取0不等于官方凭据访问0。
3. 权限应为该进程/该短时case的窄范围：仅经版本绑定证据或既有可信部署契约支持的credential-service Mach lookup，以及DNS/代理、catalog和必要refresh TLS目的地。KAS静态endpoint不能直接当native list实际依赖。当前材料未确定这些具体项；若无法据证据限定则BLOCKED，协调权限依据，不猜服务名、不边跑边逐项放开，不全局allow Mach/network。不改CA/代理/防火墙/SIP/签名。
4. Exec覆盖经审查确需的自然官方链；03仅官方+C allowlist不能证明自然Node链可执行。未知依赖是启动阻碍，不是扩展arbitrary exec的理由。不恢复M3/coalition/完整树研究。
5. 正常state可能有普通写入，不能宣称零用户写；不改真实`.kiro`设置/agents/engine，不复制账户数据。官方自身日志也须有事先隐私契约；stdout不落盘不等于全链路无secret持久化。无法控制风险则停止。
6. 新CreateNew namespace与one-shot消耗门禁；review并绑定runner/parser/policy。目录schema先以无secret合成输入验证，不凭未知schema取绿。未知stdout/stderr仅有界内存处理，不写raw/hash/repr/动态exception/traceback；只落白名单固定投影。旧流模块fake-only验证不等于real-auth HTTP观察适用。

## 成功、停止与未来预算
最多1次官方list、0prompt、0生成请求；不承诺0 auth刷新/目录网络，一次CLI不等于一次HTTP。建议未来case parent CPU10s/wall30s含清理；官方CPU3s/wall10s+kill/reap≤2s；每pipe≤64KiB、总接收≤128KiB，投影≤12KiB、全部own artifacts≤128KiB。遇cap报告失败，不自动扩容换case重试。**正常state进程不设或继承低RLIMIT_FSIZE**：要求无限；只限制own writer，避免伤及SQLite。
成功须输入绑定稳定、held实际exit0、无sticky fault/marker、双EOF、完整有界JSON严格schema有效。仅落精确ID命中布尔、有限count、exit/EOF/原因枚举及经证实来源分类。
目录含ID只能证明此次目录广告该ID；完整不含ID只能证明此次目录未列出该ID。没有新鲜live来源证据则标cache-or-source-unknown，不能声称实时后端可生成。即便新鲜live目录也不证明生成授权、额度、runtime API可用。
遇交互/浏览器marker、权限拒绝、未知exec/schema/日志风险、cap/deadline/signal/未reap/不完整EOF：保留失败，停止，不登录、不重试、不换模、不扩大权限。guard只管自有held child，不宣称独立零UI或全后代排他；清理未知不报成功。

## 请求观察适用性与后续门槛
目录case优先解决自然入口与目录证据，不自动解决Node preload/HTTP tap。若有已审查的官方支持只读观测点可证明实际sender/runtime，另报适用性；否则sender与NODE_OPTIONS继承仍UNKNOWN，不为C trace替换自然child。
真实HTTP观察另设case：先规定headers/body白名单与secret仅内存经过、构造点/发送点界限、参数/this/返回/异常/回调/取消/背压/重试的原行为保真和fail-safe；以无secret夹具验证完整契约，而非旧fake tap改名。自然sender证据与契约未齐前，不发新model请求。目录成功不授权顺带生成deepseek-3.2。
不允许结论：用户登出、credential无效、已找到实际Keychain依赖、NODE_OPTIONS被strip/继承、list必经KAS、两个catalog一致、目标能生成、任一API已实发、send前等于wire/server、parity成立。200/相同答案也不够。

## 本次只读执行记录
cwd /Volumes/D_Work/axiom2。read指定文档及必需skill；ls仅定位既有两份REPORT。读取内容低于96KiB；未读脚本/ASM/账户数据，无repo修改，无测试/官方/auth/network/model执行。
仅own TEMP写报告：system Python -I -B、ownHOME/minenv、CPU5、tool wall10、文件上限64KiB（报告硬限12KiB）。首个写报告命令exit1（shell引号导致encode名称错误，尚未创建REPORT）；未启动任何目标程序。本命令用新CreateNew目录保存报告，失败不洗绿。旧空TEMP保留。无live测试通过声明。
