/** Closed, content-free rejection diagnostics. Never include paths, values or raw errors. */
const checks = ["verification", "capability_file", "models", "auth", "models_store", "model_config", "proxy", "settings", "resource_digest", "resource_scan", "aborted", "snapshot", "lease_inactive", "before_execute"] as const;
const stages = ["configuration", "pre_io", "post_io", "resource_enumerate", "resource_open", "resource_read", "resource_recheck", "resource_traversal", "resource_final"] as const;
const scopes = ["builtin", "integration", "app", "project", "ancestor"] as const;
const resources = ["instructions", "system", "append", "extensions", "skills", "prompts", "config", "package", "entry", "settings", "mcp", "other"] as const;
const causes = ["metadata", "kind", "limit", "link", "length", "io", "aborted", "other"] as const;
export type ExecutionRejection = {
  check: typeof checks[number];
  stage?: typeof stages[number];
  scope?: typeof scopes[number];
  resource?: typeof resources[number];
  cause?: typeof causes[number];
  /** Changed metadata fields: dev=1, ino=2, mode=4, size=8, mtime=16, ctime=32, birthtime=64. */
  changed?: number;
};
export type RejectionObserver = (rejection: Readonly<ExecutionRejection>) => void;
function member<T extends string>(values: readonly T[], value: unknown): T | undefined {
  return values.includes(value as T) ? value as T : undefined;
}
/** Reconstruct a whitelist even for custom environments; diagnostic observers cannot affect admission. */
export function safeExecutionRejection(input: unknown): Readonly<ExecutionRejection> {
  try {
    if (!input || typeof input !== 'object') return Object.freeze({ check: 'verification' });
    const value = input as Record<string, unknown>;
    // Read each property once: a getter must not swap a validated enum/number for private text.
    const check = member(checks, value.check), stage = member(stages, value.stage), scope = member(scopes, value.scope),
      resource = member(resources, value.resource), cause = member(causes, value.cause), changed = value.changed;
    const result: ExecutionRejection = { check: check ?? 'verification' };
    if (stage) result.stage = stage;
    if (scope) result.scope = scope;
    if (resource) result.resource = resource;
    if (cause) result.cause = cause;
    if (typeof changed === 'number' && Number.isInteger(changed) && changed >= 0 && changed <= 127) result.changed = changed;
    return Object.freeze(result);
  } catch { return Object.freeze({ check: 'verification' }); }
}
export function rejectExecution(observer: RejectionObserver | undefined, rejection: ExecutionRejection): false {
  try { observer?.(safeExecutionRejection(rejection)); } catch { /* Observability must not affect the gate. */ }
  return false;
}
