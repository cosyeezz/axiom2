import { PluginError, PluginErrorCollector } from './plugin-protocol';
/**
 * Plugin error collector implementation
 * Stores errors in memory for the current session
 */
export declare class PluginErrorCollectorImpl implements PluginErrorCollector {
    private errors;
    private readonly onDidChangeEmitter;
    readonly onDidChange: import("@celljs/core").Event<void>;
    addError(error: any): void;
    getErrors(): PluginError[];
    getErrorsByType(type: PluginError['type']): PluginError[];
    getErrorsByPlugin(pluginName: string, marketplaceName: string): PluginError[];
    getErrorCount(): number;
    clearErrors(): void;
    clearPluginErrors(pluginName: string, marketplaceName: string): void;
}
//# sourceMappingURL=plugin-error-collector.d.ts.map