/**
 * 运行时能力表：每一项都是"允许做什么"的正向语义。
 * 官方版全部为 true，定制版按协议约束关掉相应位。
 */
export interface ProductCapabilities {
    /** 是否允许自动更新（后台定时检查并下载新版本）。定制版按 `updates` 派生。 */
    autoUpdate: boolean;
    /** 是否允许手动 `codebuddy update` 触发官方 registry 更新。定制版按 `updates` 派生。 */
    manualUpdate: boolean;
    /** 是否允许注册系统 Daemon（launchd / systemd / TaskScheduler）。定制版禁用。 */
    systemDaemon: boolean;
    /**
     * 是否允许 settings.json 里的 `endpoint` / `enterpriseEndpoint` 覆盖默认端点。
     * 定制版禁用：客户 Endpoint 由 customization.json 固定，用户手改 settings 不能绕过。
     */
    settingsEndpointOverride: boolean;
    /**
     * 客户自建更新源。
     *
     * `undefined` 表示走官方更新源（官方版 or 定制版 `updates: {disabled:true}` 时都是它）。
     * 有值时表示定制版启用了客户源，`ReleasesService` 用 `baseUrl` 派生
     * `${baseUrl}/latest` / `${baseUrl}/download/{version}/{filename}`。
     *
     * 只在 `autoUpdate` / `manualUpdate` 至少一项为 true 时非空。
     */
    customUpdateSource?: {
        /** 从 checkVersion.url 派生的 baseUrl（已去除 `/latest` 尾部与末尾斜杠）。 */
        baseUrl: string;
        /** 后台轮询间隔（秒），来自 `updates.checkVersion.intervalSeconds`。 */
        intervalSeconds?: number;
    };
}
/**
 * 派生当前进程的能力表。
 *
 * 官方版返回所有能力开启；定制版按协议关掉：更新、系统 Daemon、
 * settings endpoint 覆盖、官方市场。
 *
 * **判定颗粒度**（Issue 评审 blocker：显式禁用更新不能被误判为空配置而静默丢弃）：
 * - 「真实定制内容」（品牌 / 端点 / 目录 / 链路 / 遥测任一有实际内容）→ 四个能力位全关（白牌全面隔离）；
 * - 「只显式禁更新」的最小配置（如 `{"updates":{"disabled":true}}`）→ **只关**
 *   autoUpdate / manualUpdate；systemDaemon 与 settingsEndpointOverride 维持官方行为
 *   （客户没提这两项，不替他做决定）；
 * - `{}` 空模板 / 未涉及更新意图 → 视同官方。
 *
 * `updates` 派生规则：
 * - 未配 / `{ disabled: true }` → autoUpdate=false, manualUpdate=false, customUpdateSource=undefined
 * - 配了 `checkVersion.url + download.url`：
 *   - manualUpdate 恒为 true
 *   - autoUpdate = !manualOnly
 *   - customUpdateSource = 派生 baseUrl
 *
 * 未来若需要按定制配置细粒度控制，在此函数内加分支即可，消费方无需任何改动。
 */
export declare function resolveProductCapabilities(): ProductCapabilities;
