import { Command } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { ReferenceService } from '../references';
import { ShellService } from '../shell/shell-protocol';
import { CustomCommandRenderer } from './command-protocol';
/**
 * Service for rendering custom commands with parameter replacement
 * Replaces $1, $2, $3, etc. with provided arguments
 */
export declare class CustomCommandRendererImpl implements CustomCommandRenderer {
    protected readonly referenceService: ReferenceService;
    protected readonly shellService: ShellService;
    protected readonly logger: Logger;
    /**
     * Render custom command prompt with parameter replacement and file references
     * @param command The command containing prompt template and name
     * @param input The full input text containing command and arguments
     * @returns The prompt with parameters replaced and file references processed
     */
    render(command: Command, input: string): Promise<string>;
    /**
     * Process markdown content with inline bash execution, argument replacement, and file references.
     * Pipeline: $ARGUMENTS replacement → !`command` execution → @file reference processing
     */
    processContent(content: string, args?: string): Promise<string>;
    private executeInlineBash;
    private replaceParameters;
    private extractArguments;
}
