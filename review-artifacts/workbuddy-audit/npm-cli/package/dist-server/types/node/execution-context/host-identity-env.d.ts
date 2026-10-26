/**
 * 宿主进程身份只对本 CLI 进程有效，不得进入用户命令。
 *
 * - 宿主数据目录：用户命令里的 `codebuddy`（自装旧版、npm 全局版）继承后会把宿主数据目录
 *   当作自己的 home，并按它自己的策略读写——旧版 CLI 启动即按 30 天清理会话历史，曾借此删光
 *   WorkBuddy 的 `~/.workbuddy/projects`（#152783）。第一方脚本 / shim 需要宿主目录时
 *   读 `WORKBUDDY_CONFIG_DIR`，它不受此处影响。
 * - daemon / 服务端身份：嵌套 `codebuddy -p` 继承 `CODEBUDDY_SESSION_KIND=daemon` 后会把自己
 *   当成 daemon，启动防休眠、预热主会话（清空本次任务）并抢占频道连接，print 结束后也不退出；
 *   继承 `SERVER__PORT` 则会去绑定父进程已占用的端口（#159533）。PTY 子 shell 的 `ptyEnv`
 *   一直剥离同类变量，工具子进程与之保持一致。
 */
export declare const HOST_IDENTITY_ENV_KEYS: readonly ["CODEBUDDY_CONFIG_DIR", "CODEBUDDY_SESSION_KIND", "CODEBUDDY_SESSION_NAME", "CODEBUDDY_SESSION_LOG", "CODEBUDDY_DAEMON_CONFIGURED_PORT", "CODEBUDDY_DESKTOP_DAEMON_STABLE_PORT", "CODEBUDDY_DAEMON_RESTORE_CHANNELS", "SERVER__PORT", "SERVER__HOST"];
export declare function scrubHostIdentityFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>, platform?: NodeJS.Platform): void;
