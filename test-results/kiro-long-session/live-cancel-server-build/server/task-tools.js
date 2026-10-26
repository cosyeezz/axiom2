import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { modelTaskOutput } from "./task-output.js";
export function taskTools(call) {
    const execute = (name) => async (id, params, signal) => {
        signal?.throwIfAborted();
        const details = await call(name, id, params, signal);
        return {
            content: [{ type: "text", text: JSON.stringify(modelTaskOutput(name, details)) }],
            details,
        };
    };
    return [
        defineTool({
            name: "delegate",
            label: "委派子任务",
            description: "Delegate multiple independent asynchronous tasks for research, analysis, review, testing, builds, or static checks. Each task's final report must fit within 2000 characters. Split tasks so that each report can include its conclusion and necessary evidence within that limit.",
            parameters: Type.Object({
                context: Type.String({ description: "Shared background for all tasks, no more than 200 characters. Subagents do not know the main session's context: explain why these tasks are delegated and how their results will be used." }),
                tasks: Type.Array(Type.Object({
                    title: Type.String({ description: "Summarize this task's core goal in no more than 30 characters." }),
                    task: Type.String({ description: "Specific assignment for this task. Together with the shared background, make clear what to do, what constraints apply, and what to deliver." }),
                }, { additionalProperties: false })),
            }, { additionalProperties: false }),
            execute: execute("delegate"),
        }),
        defineTool({
            name: "append",
            label: "追问子任务",
            description: "Add requirements to an existing subtask to supply information, adjust direction, or continue work. Finished subtasks can resume. Do not use this tool to check progress.",
            parameters: Type.Object({
                taskId: Type.String({ description: "Task reference from a delegate response or completion notification." }),
                summary: Type.String({ description: "Summarize the core additional requirement in no more than 30 characters." }),
                text: Type.String({ description: "Specific additional requirements. Together with the original assignment, make clear what to add or adjust and what to deliver." }),
            }, { additionalProperties: false }),
            execute: execute("append"),
        }),
        defineTool({
            name: "cancel_task",
            label: "停止子任务",
            description: "Stop the specified subtask without affecting other tasks.",
            parameters: Type.Object({
                taskId: Type.String({ description: "Task reference from a delegate response or completion notification." }),
                reason: Type.Optional(Type.String({ description: "Why should this subtask be stopped?" })),
            }, { additionalProperties: false }),
            execute: execute("cancel_task"),
        }),
        defineTool({
            name: "read_result",
            label: "读取子任务结果",
            description: "Read the exact subtask result identified by a completion notification. Results can be read repeatedly.",
            parameters: Type.Object({
                taskId: Type.String({ description: "Task reference from the same completion notification as resultId." }),
                resultId: Type.String({ description: "Result reference from the same completion notification as taskId; identifies that specific result, not the latest." }),
            }, { additionalProperties: false }),
            execute: execute("read_result"),
        }),
    ];
}
//# sourceMappingURL=task-tools.js.map