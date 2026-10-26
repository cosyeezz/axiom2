import { Command } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { McpManager } from '../mcp/mcp-protocol';
import { McpPromptRenderer } from './command-protocol';
/**
 * Service for rendering MCP prompts by calling MCP servers
 */
export declare class McpPromptRendererImpl implements McpPromptRenderer {
    protected readonly mcpManager: McpManager;
    protected readonly logger: Logger;
    /**
     * Render MCP prompt command by calling the MCP server
     * @param command The MCP prompt command containing the server:prompt name
     * @param input The full input text containing command and arguments
     * @returns The rendered prompt text from the MCP server
     */
    render(command: Command, input: string): Promise<string>;
    /**
     * Parse command to extract server name and prompt name from command.prompt
     * @param command The MCP prompt command
     * @returns Object with serverName and promptName
     */
    private parsePromptName;
    /**
     * Parse argument names from argumentHint
     * @param argumentHint The argument hint string (e.g., "arg1, arg2, arg3")
     * @returns Array of argument names in order
     */
    private parseArgumentNames;
    /**
     * Extract arguments from input text by splitting on spaces and mapping to argument names by position
     * @param input The full input text
     * @param commandName The command name to remove from input
     * @param argumentNames The ordered list of argument names from the prompt definition
     * @returns Object with args (mapped key-value pairs) and remainingArgs (unmapped values)
     */
    private extractArguments;
    /**
     * Convert MCP prompt messages to plain text
     * @param messages The messages array from MCP server's getPrompt result
     * @returns Formatted text representation
     */
    private convertPromptMessagesToText;
}
