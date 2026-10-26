import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { TaskStorageService } from './task-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const TaskCreateParameters: z.ZodObject<{
    subject: z.ZodString;
    description: z.ZodString;
    activeForm: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    owner: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    description: string;
    subject: string;
    owner?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    activeForm?: string | undefined;
}, {
    description: string;
    subject: string;
    owner?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    activeForm?: string | undefined;
}>;
export declare class TaskCreateTool extends BaseTool implements Tool {
    protected readonly taskStorageService: TaskStorageService;
    protected readonly logger: Logger;
    name: ToolNames;
    parameters: z.ZodObject<{
        subject: z.ZodString;
        description: z.ZodString;
        activeForm: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        owner: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        subject: string;
        owner?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        activeForm?: string | undefined;
    }, {
        description: string;
        subject: string;
        owner?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        activeForm?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(input: z.infer<typeof TaskCreateParameters>, context?: RunContext<Session>): Promise<ToolResult>;
    /**
     * Validate task-create params.
     *
     * - First runs zod schema validation via {@link ZodUtils.validate} for shape / type errors.
     * - Then enforces business-level semantics that zod alone cannot express:
     *   required strings must be non-empty after trim, optional strings (when supplied)
     *   must not be blank, and metadata must be a plain object.
     *
     * Returns a human-readable reason on failure (consumed by execute() to throw),
     * or undefined when input is valid.
     */
    private validateToolParams;
    /**
     * Generate activeForm from subject by converting to present continuous
     * e.g., "Run tests" -> "Running tests"
     *
     * Only an English verb can take "-ing"; any other leading word (CJK text,
     * step labels like "T2", numbers) keeps the subject as-is.
     */
    private generateActiveForm;
}
export {};
