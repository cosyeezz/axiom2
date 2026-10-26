import type { PromptContext } from '../../vendor/cbc-core/node/index.js';
import { type Memory } from '../memory/memory-protocol';
/** cbc `Memory` → 官方 `InstructionFile`。 */
export declare function instructionFileOf(memory: Memory): Record<string, unknown>;
/** 官方 `InstructionFile` → cbc `Memory`（只回填 mod 可能改动的字段）。 */
export declare function memoryOf(file: Record<string, unknown>, known: Map<string, Memory>): Memory;
export declare function foldModsPromptContext(context: PromptContext, dispatch: (input: {
    blocks: never[];
    instructionFiles: Record<string, unknown>[];
}) => Promise<Record<string, unknown>>): Promise<PromptContext>;
