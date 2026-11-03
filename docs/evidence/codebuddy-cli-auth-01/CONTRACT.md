# CodeBuddy CLI 现有登录态复用核验

用户授权复用 Axiom 已登录 CodeBuddy 账号；只关注官方 CLI 2.179.0，不研究桌面，不重新登录或调用模型。

第一阶段（已完成）仅静态入口调查和本地账号元数据预检：不执行官方bundle，不进行网络认证、不写CLI凭据缓存、不更改Axiom模型/代理/账号选择。允许受控脚本通过正常当前账号路由在RAM读取既有凭据，输出仅存在性、类型、过期分类与未变谓词；不输出Token/refresh/profile原值、凭据hash或未知错误。清除仅属于当前代理执行快照的账号绑定后，遵循Axiom真实active账号，不读取其他应用凭据。

官方 CODEBUDDY_AUTH_TOKEN 入口已由四窗口读回证实；它恢复 custom-token 会话，不持有refresh token，不自动续期。没有已证安全的 CLI auth status 命令，因此不启动完整CLI、不声称已创建官方运行中的登录会话。令牌仅验证进程RAM，不放命令行、日志、证据文件或CLI缓存；此轮根本不传refresh token给CLI。不将通用自定义API-key路径误报为完整CN OAuth兼容。若需刷新，归Axiom现有锁内刷新owner，本case不刷新，过期则停止。

第一阶段预算及实绩：网络0、模型0、官方bundle执行0；本地预检30秒，输出<=4KiB。静态t12192三结果r12193/r12197/r12198已全部读取；三独立定点阶段12窗45900B、8窗32760B、4窗15700B关闭。主代理只复核其中6窗口，保存公开原文。安装原件与验证在用户目录codebuddy-install-u0JnFK，不重复下载或安装。

## 第二阶段：一次独立账号有效性检查

官方getAccountSnapshot已证GET `/v2${prefixPath}/accounts`，配置prefixPath=/plugin；CN产品配置endpoint=https://copilot.tencent.com，与Axiom当前OAuth固定origin一致。其方法检查账户列表非空；全CLI当前环境选择/通用头/业务码拦截未全核，本阶段不是完整wire parity或官方CLI启动验收。

- 仅允许一次 `GET https://copilot.tencent.com/v2/plugin/accounts`，无body；直接node:https、默认系统TLS验证、独立连接、不跟redirect、不重试，15秒绝对时限、响应<=1MiB。此独立进程直连不修改Axiom代理配置，也不假称复用了应用sender。
- Authorization使用Axiom正常当前账号路由的现有未到期access。X-Domain固定CN源域；User-Agent明确标为独立检查，不伪称这是完整官方CLI请求。只读账号接口，无模型/目录/refresh/登录/切账号/logout/工具调用。服务端正常审计记录不作零副作用保证。
- 实发前新wx claim限一次，脚本import-safe；先合成测试解析/边界/超时/禁止redirect，不读真实凭据/联网。自测通过后再实发，不重放claim。
- 本地采用更保守的验收：HTTP2xx、数值业务code0、data.accounts为非空数组；这不是对官方统一code策略的声称。只输出HTTP状态、数值业务码、账户存在性、字节数、资源关闭、文件未变等白名单。原响应只留RAM，不输出账户身份/错误原文，不存令牌/响应/凭据hash。
- 读取前后核当前选中凭据、账号索引与模型设置字节未变；如账号路由变化或凭据近到期则停止，不刷新。原始异常只转固定错误码。最多1认证请求、0模型、0刷新；官方bundle执行始终0。

