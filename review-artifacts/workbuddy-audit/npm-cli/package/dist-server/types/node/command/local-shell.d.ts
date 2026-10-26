import { type Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type Observable } from 'rxjs';
import { Hook, HookEvent, type HookExecutionResult, type HookInput, HookPriority } from '../hooks/hook-protocol';
import { ShellService } from '../shell/shell-protocol';
import { InteractiveShellManager } from './bash-command-executor';
export interface LocalShellRequest {
    command: string;
    interactive?: boolean;
    signal?: AbortSignal;
}
export interface LocalShellEntry {
    readonly id: string;
    readonly anchorId?: string;
    readonly kind: 'input' | 'output';
    readonly text: string;
    readonly detail?: string;
}
export declare class LocalShell implements Hook {
    readonly event = HookEvent.SESSION_END;
    readonly priority = HookPriority.Normal;
    protected readonly shellService: ShellService;
    protected readonly sessionManager: SessionManager;
    protected get interactiveShellManager(): InteractiveShellManager;
    private readonly states;
    output(session: Session): Observable<readonly LocalShellEntry[]>;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
    run(session: Session, { command, interactive, signal }: LocalShellRequest): Promise<void>;
    private state;
    private clear;
    private append;
}
