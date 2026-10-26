/**
 * Skills / MCP 切分 · 上下文消耗 5 类目细拆专用。
 * Skill 的 `<available_skills>` 归 skills；ToolSearch 的 `mcp__` 行归 mcp。
 */
import type { ToolLike } from './usage-by-category-calculator';
export interface ToolsBuckets {
    toolsChars: string;
    mcpChars: string;
    skillsChars: string;
}
export declare function collectToolsBuckets(tools: ReadonlyArray<ToolLike>): ToolsBuckets;
