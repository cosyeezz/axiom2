import { NotebookEditTool } from './notebook-edit-tool';
import { Tool } from './tool-protocol';
export declare class NotebookWriteTool extends NotebookEditTool implements Tool {
    name: string;
    defer_loading: boolean;
    aliases: string[];
}
