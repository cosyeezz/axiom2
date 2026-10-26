export function prepare(): void;
export function spawnDaemon(command: string, args: readonly string[], options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    logPath?: string;
}): Promise<{ pid: number }>;
