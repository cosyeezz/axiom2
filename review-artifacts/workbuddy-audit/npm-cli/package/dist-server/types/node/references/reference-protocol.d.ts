export declare const ReferenceService: unique symbol;
export interface ReferenceService {
    process(content: string, currentFilePath?: string): Promise<string>;
    /**
     * 配置 path-only 模式。
     *
     * 启用后 {@link ReferenceService.process} 不会读取 `@path` 文件内容
     * 注入上下文，保留原文路径，由模型按需通过 Read 工具读取。
     *
     * 该开关由最外层 transport（如 ACP initialize 握手）在拿到 client
     * capability 后主动调用本方法写入；ReferenceService 自身不感知
     * transport 类型，非 ACP 路径（TUI 等）不调用即默认关闭，自然
     * 降级到旧的 `@path` 自动展开行为。
     */
    setFileReferencesPathOnly(enabled: boolean): void;
    /**
     * 当前是否处于 path-only 模式。
     */
    isFileReferencesPathOnly(): boolean;
}
