import { Logger } from '@celljs/core';
import { Subject } from 'rxjs';
import { McpConfig, McpScope, McpServerModel, McpServerModelManager } from './mcp-protocol';
export declare class McpServerModelManagerImpl implements McpServerModelManager {
    protected readonly logger: Logger;
    changedSubject: Subject<McpServerModel>;
    private readonly cache;
    private emitSeq;
    create(scope: McpScope, name: string, config: McpConfig): McpServerModel;
    get(name: string, scope?: McpScope): McpServerModel | undefined;
    delete(scope: McpScope, name: string): void;
    deleteScope(scope: McpScope): void;
    private getCacheKey;
}
