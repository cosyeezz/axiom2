import { Workspace } from '@genie/runtime';
import { z } from 'zod';
import { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { TodoStorageService } from './todo-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const TodoWriteParameters: z.ZodObject<{
    oldTodos: z.ZodArray<z.ZodObject<{
        content: z.ZodString;
        activeForm: z.ZodString;
        status: z.ZodEnum<["pending", "in_progress", "completed"]>;
    }, "strip", z.ZodTypeAny, {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }, {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }>, "many">;
    newTodos: z.ZodArray<z.ZodObject<{
        content: z.ZodString;
        activeForm: z.ZodString;
        status: z.ZodEnum<["pending", "in_progress", "completed"]>;
    }, "strip", z.ZodTypeAny, {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }, {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    oldTodos: {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }[];
    newTodos: {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }[];
}, {
    oldTodos: {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }[];
    newTodos: {
        content: string;
        status: "pending" | "in_progress" | "completed";
        activeForm: string;
    }[];
}>;
export declare class TodoWriteTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly todoStorageService: TodoStorageService;
    name: ToolNames;
    parameters: z.ZodObject<{
        oldTodos: z.ZodArray<z.ZodObject<{
            content: z.ZodString;
            activeForm: z.ZodString;
            status: z.ZodEnum<["pending", "in_progress", "completed"]>;
        }, "strip", z.ZodTypeAny, {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }, {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }>, "many">;
        newTodos: z.ZodArray<z.ZodObject<{
            content: z.ZodString;
            activeForm: z.ZodString;
            status: z.ZodEnum<["pending", "in_progress", "completed"]>;
        }, "strip", z.ZodTypeAny, {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }, {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        oldTodos: {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }[];
        newTodos: {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }[];
    }, {
        oldTodos: {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }[];
        newTodos: {
            content: string;
            status: "pending" | "in_progress" | "completed";
            activeForm: string;
        }[];
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(input: z.infer<typeof TodoWriteParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
export {};
