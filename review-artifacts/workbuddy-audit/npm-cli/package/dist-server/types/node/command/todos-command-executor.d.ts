import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { TaskStorageService } from '../tools/task-storage-service';
import { TodoStorageService } from '../tools/todo-storage-service';
import { CommandExecuteContext, CommandExecutor } from './command-protocol';
export declare class TodosCommandExecutor implements CommandExecutor {
    name: string;
    message: string;
    autoGenerateHistory: boolean;
    protected readonly sessionManager: SessionManager;
    protected readonly todoStorageService: TodoStorageService;
    protected readonly taskStorageService: TaskStorageService;
    execute(ctx: CommandExecuteContext): Promise<void>;
    private extractTodoListFromHistory;
    private formatTodos;
    private getStatusIcon;
}
