/**
 * 本机进程访问本机 Gateway（daemon / `--serve`）时携带的凭据。
 *
 * daemon 默认启用密码鉴权（issue #78178），`daemon status`、teammate 回调 leader 等本机调用方
 * 需要与服务端 `LocalGatewayAuth.setup()` 同源取密码：
 * `CODEBUDDY_GATEWAY_PASSWORD` env > settings `gateway.password`。
 *
 * 只对回环地址附带：本机密码不能发给远端实例。
 */
export declare function isLoopbackUrl(url: string): boolean;
export declare function resolveLocalGatewayPassword(): Promise<string | undefined>;
/** 访问 `url` 所需的 Authorization 头；非回环地址或无密码时返回空对象。 */
export declare function localGatewayAuthHeaders(url: string): Promise<Record<string, string>>;
