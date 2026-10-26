/** Declares what capabilities the SDK supports. */
export interface SdkCapabilities {
    /** SDK supports handling AskUserQuestion tool via canUseTool callback */
    askUserQuestion?: boolean;
    /**
     * SDK 声明可处理 elicitation（形状对齐 ACP ClientCapabilities.elicitation）。
     * form=true 表示 SDK 注册了 elicitation create 处理器。
     * 只有声明后才能下发 elicitation_create，避免老 SDK 丢弃未知请求造成挂起。
     */
    elicitation?: {
        form?: boolean;
    };
}
//# sourceMappingURL=sdk-capabilities.d.ts.map