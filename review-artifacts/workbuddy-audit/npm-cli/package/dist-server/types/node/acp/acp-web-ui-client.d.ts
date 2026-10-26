import type { HumanInputSurface } from '../../vendor/cbc-core/node/index.js';
/**
 * Web UI ACP 握手身份。WorkBuddy / Zed 等 --acp 客户端不带这个名字。
 * 刷新快照、busy 工具、/goal drain 只对这个客户端生效，避免改到共用 --acp 语义。
 */
export declare const ACP_WEB_UI_CLIENT_NAME = "codebuddy-web-ui";
export declare function isWebUiAcpClientName(name: unknown): boolean;
/**
 * 会话是否由某个 ACP 宿主（Web UI / WorkBuddy / Zed…）驱动。
 *
 * 不能只看 `session.options.acp`：served 会话换进程（插件刷新 / runtime 回收）后，
 * 新进程里这个传输位会丢，但 `session.meta.acpConnectionId` 还在。只看 options 会把
 * 会话级帧（goal 状态 / 快照）静默丢掉——实测：暂停后点继续 / 清除没有任何反应。
 * 口径与 BackgroundTaskNotifier.isAcpAttachedSession 一致。
 */
export declare function isAcpHostSession(session: {
    options?: object;
    meta?: Record<string, unknown>;
}): boolean;
export declare function isWebUiAcpSession(session: {
    options?: object;
}): boolean;
/** ACP prompt 的来源界面：marker 在每次 prompt 前按本连接重盖，所以此刻读到的就是发这句话的连接。 */
export declare function humanInputSurfaceOf(session: {
    options?: object;
}): HumanInputSurface;
/**
 * Keep the in-memory Web-ACP marker aligned with the connection that most
 * recently admitted the session.
 *
 * A same-id session may be reused instead of deserialized again.  In that
 * case simply doing nothing for non-Web clients leaves a stale `webUiAcp`
 * bit behind and lets WorkBuddy enter Web-only goal/follow-up behaviour.
 * The marker is transport state, not durable session identity, so an
 * unopted ACP client must actively clear it.
 */
export declare function syncWebUiAcpSessionFlag<T extends {
    options?: object;
}>(session: T, webUiAcp: boolean): void;
