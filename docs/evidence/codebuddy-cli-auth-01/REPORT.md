# CodeBuddy 现有登录态复用核验

## 结论

**可以将 Axiom 现有访问令牌交给官方 CLI 的临时 Token 入口，无需重复登录。** 官方 CLI 2.179.0 的 `CODEBUDDY_AUTH_TOKEN` 入口已由静态源码确认；Axiom 当前访问令牌另经一次独立账号接口请求验证有效。未启动完整 CLI，未把令牌写进 CLI 配置，也未发送模型请求。

注意：该入口恢复的是 **custom-token 会话**，没有 refresh token，不自动续期。以后每次受控运行应由 Axiom 正常账号生命周期提供当前有效 access token，不能让 CLI 和 Axiom 各自管理同一刷新令牌。本轮现有 Token 未过期，未执行刷新。

## 证据与结果

- [合同](CONTRACT.md)：用户授权复用本人既有登录态；限定 CLI、RAM 凭据、无模型调用；实发预算为1个只读账号 GET。
- [本地预检](preflight.json)：当前 `codebuddy-cn` OAuth access/refresh 均存在，未过期且五分钟内无需刷新；只读，文件未变，网络/子进程拦截触发0。[预检脚本](PREFLIGHT.mjs) 仅输出元数据。
- [官方入口窗口](token-injection.txt)：进程 `CODEBUDDY_AUTH_TOKEN` 优先；原 token 进入 `auth.accessToken`；refresh 为空、固定远期失效值。[JWT身份窗口](token-identity.txt) 仅 decode，不代表服务端认证。
- [认证存储窗口](credential-storage.txt)：`CODEBUDDY_CREDENTIALS_IN_MEMORY=1` 只控制认证存储，不代表整个CLI零写盘。[产品域选择](domain-selection.txt) 按 token 的 issuer-domain 选环境，不应篡改 issuer。
- [账户请求窗口](account-query.txt)：官方 `getAccountSnapshot` 使用 GET `/v2${prefixPath}/accounts`；CN随包配置为 `https://copilot.tencent.com`、prefixPath `/plugin`。[endpoint拦截器](endpoint-interceptor.txt) 实际取产品配置，不能把所有CLI部署都说成固定CN地址。
- [合成自测](selftest.json)：9次合成 sender，真实网络0；覆盖成功、401、业务失败、空/错误账户结构、非法JSON、redirect拒绝、响应上限、超时、header换行拒绝、输出脱敏和资源关闭。[检查脚本](CHECK.mjs) import-safe，真实模式先核自测脚本SHA再读凭据；有一次性claim。
- [真实结果](PROJECTION.json)：**HTTP200、业务code0、账户列表非空**；1次账号 GET，响应580B；模型0、刷新0；请求已关闭，账号路由与凭据/索引/模型/设置文件前后未变。脚本 exit0，stderr为空。claim时间 `2026-10-31T08:42:52.819Z`，**已耗尽，不得重跑 `--live`**。

## 验证边界

真实请求是独立 Node HTTPS 账号检查：固定 `https://copilot.tencent.com/v2/plugin/accounts`、默认TLS验证且显式 `rejectUnauthorized:true`、直连、不跟redirect/重试、15秒与1MiB限额。UA明确为 `Axiom-CodeBuddy-Auth-Check/1`，不是伪称完整官方CLI流量。HTTP2xx+code0+非空accounts是本case保守验收规则；官方账户方法本身只见非空账户判据。

静态调查没有完整还原所有配置选择、公共headers或业务码拦截器；未执行CLI的401/logout副作用。**本结果不等于CLI完整启动、持久登录、模型请求、目录权限、工具或协议完全对齐验收。** 后续CLI实测仍需隔离HOME/配置目录、RAM注入、独立请求预算及环境保护。

未输出/保存 token、refresh token、原账户响应、账号身份或凭据hash；未更改Axiom默认模型/代理、官方安装文件、项目依赖或生产源码，未构建/重启服务。文件未变由进程内原字节比较确认；网络防护是代码级限制，不是OS沙箱或全系统网络审计。服务端正常访问审计不作零副作用承诺。

[最终读回](final-readback.json) 核对证据、窗口原字节、脚本指纹与本报告链接；不重复网络或已通过的测试。
