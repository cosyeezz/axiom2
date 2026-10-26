import { Logger } from '@genie/telemetry';
import { PromptContext, PromptContextInitializer, PromptContextProvider } from './context-protocol';
export declare class PromptContextProviderImpl implements PromptContextProvider {
    protected readonly initializers: PromptContextInitializer[];
    protected readonly logger: Logger;
    private pendingPromise;
    get(): Promise<PromptContext>;
    private resolve;
}
//# sourceMappingURL=prompt-context-provider.d.ts.map