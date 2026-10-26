/**
 * 幂等：同一 (sessionId, agentId) 重复调用不写盘。未知 agentId / 缺参直接忽略。
 * 整段读-改-写在目录锁内完成，避免与控制器 / 其它进程的整份重写互相覆盖。
 */
export declare function registerAgentHomeSessionOwner(homeDir: string, sessionId: string | undefined, agentId: string | undefined): Promise<boolean>;
