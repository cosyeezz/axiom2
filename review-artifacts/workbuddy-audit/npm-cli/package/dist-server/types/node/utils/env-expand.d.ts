/**
 * Environment variable expansion for string values.
 *
 * Pure function – no DI dependency. Detects `${VAR_NAME}` and `${VAR_NAME:-default}` placeholders
 * and replaces them with values from an explicit environment snapshot.
 */
export interface EnvExpandResult {
    /** The string with all resolvable placeholders replaced */
    expanded: string;
    /** De-duplicated list of variable names that were not found in process.env */
    missingVars: string[];
}
/**
 * Expand `${VAR_NAME}` and `${VAR_NAME:-default}` placeholders in `input`.
 *
 * - Variables that exist in `process.env` are replaced with their value.
 * - `${VAR_NAME:-default}` uses the default value if the variable is not set.
 * - `${VAR_NAME}` without a default that is **not** found is left as-is
 *   (`${VAR}` is preserved) and added to `missingVars`.
 * - `missingVars` is de-duplicated.
 *
 * @example
 * // With process.env = { API_KEY: 'secret' }
 * expandEnvVariables('${API_KEY}')                    // → { expanded: 'secret', missingVars: [] }
 * expandEnvVariables('${MISSING}')                    // → { expanded: '${MISSING}', missingVars: ['MISSING'] }
 * expandEnvVariables('${MISSING:-default}')           // → { expanded: 'default', missingVars: [] }
 * expandEnvVariables('${API_KEY:-fallback}')          // → { expanded: 'secret', missingVars: [] }
 */
export declare function expandEnvVariables(input: string, environment?: Readonly<NodeJS.ProcessEnv>): EnvExpandResult;
