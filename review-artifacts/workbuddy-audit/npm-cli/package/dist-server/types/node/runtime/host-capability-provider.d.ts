/**
 * Env var the host uses to advertise its capabilities to builtin-plugin MCP
 * stdio children (injected by McpServerManager alongside
 * CODEBUDDY_SERVICE_PROXY_URL / CODEBUDDY_PLUGIN_ROOT). Comma-separated,
 * dot-hierarchical capability bits — see HOST_CAPABILITY.
 */
export declare const HOST_CAPABILITIES_ENV = "CODEBUDDY_HOST_CAPABILITIES";
/**
 * Capability bits, dot-hierarchical (aligned with ACP/MCP
 * `capabilities.elicitation.form`). Plugins read the var, split on `,`, and
 * `includes()` the bit they care about; unknown future bits are ignored.
 */
export declare const HOST_CAPABILITY: {
    /** Host can present an elicitation form — the channel weixinpay confirmation cards use. */
    readonly ELICITATION_FORM: "elicitation.form";
    /** Host intercepts `WeixinPay-Required:` and renders it as a confirmation card (vs. the plugin's own LLM flow). */
    readonly WEIXINPAY_INTERCEPTION: "weixinpay.interception";
};
/**
 * Process-level snapshot of host capabilities advertised to builtin-plugin MCP
 * children via `CODEBUDDY_HOST_CAPABILITIES`.
 *
 * Populated from the NEGOTIATED client capabilities — not the process mode — at
 * initialize, before the (lazily-spawned) plugin MCP reads its env. Each bit is
 * declared independently by the client (no deriving one from another):
 *   - ACP: `clientCapabilities.elicitation.form` (standard) → markElicitationForm;
 *     `clientCapabilities._meta['codebuddy.ai'].weixinpay.interception` (custom,
 *     nested 父.子 to mirror the dotted env bit / `elicitation.form`) →
 *     markWeixinpayInterception. The desktop declares both only for non-Claw
 *     sessions (`supportsElicitation = !isClawWorkspaceCwd`).
 *   - stream-json SDK: `capabilities.elicitation.form` at `InitializeHandler`
 *     (the SDK has no separate weixinpay bit yet, so it unlocks both).
 * Initialize lands before first tool use, hence before the process-cached
 * weixinpay MCP spawns.
 *
 * IMPORTANT — not a per-payment verdict, and does NOT reflect the remotely-toggled
 * `WeixinPayInterception` kill-switch (that stays host-side in `PaymentInterceptor`).
 * When no elicitation capability is negotiated (TUI / `--print` / Claw / any client
 * that didn't declare `elicitation.form`), nothing is advertised → the weixinpay
 * plugin reads no `weixinpay.interception` and self-disables (its own fail-safe:
 * surface a "请到电脑端使用" redirect, never hard-fail).
 */
export declare class HostCapabilityProvider {
    private readonly capabilities;
    /** Advertise `elicitation.form` (peer declared it can render an elicitation form). Idempotent. */
    markElicitationForm(): void;
    /** Advertise `weixinpay.interception` (peer declared it supports the weixinpay confirm card). Idempotent. */
    markWeixinpayInterception(): void;
    /** Whether a capability bit has been advertised (exported for tests / internal checks). */
    has(capability: string): boolean;
    /**
     * Comma-separated capability bits for `CODEBUDDY_HOST_CAPABILITIES`, or
     * `undefined` when none have been advertised — callers then OMIT the env
     * var entirely so the plugin reads "not present" and fail-opens.
     */
    toEnvValue(): string | undefined;
}
