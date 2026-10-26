import { PromptManager } from '@genie/prompts';
import { PromptContext, PromptContextProvider, PromptRenderer } from './context-protocol';
export declare class PromptRendererImpl implements PromptRenderer {
    protected readonly promptManager: PromptManager;
    protected readonly promptContextProvider: PromptContextProvider;
    render(template: string, context?: PromptContext): Promise<string>;
}
//# sourceMappingURL=prompt-renderer.d.ts.map