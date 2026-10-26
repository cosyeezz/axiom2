import { delimiter, join } from "node:path";
import { mkdirSync } from "node:fs";
import { toolEnvironment } from "./model-proxy-env.js";

export type BuiltinComponent = "rea" | "opencli" | "rtk" | "model-proxy";
/** Runtime isolation, not a filesystem/security sandbox. Keep OS credentials,
 * browser profiles, certificates and external commands available intentionally. */
export function componentEnvironment(directory: string, source = process.env, nodeDirectory?: string): NodeJS.ProcessEnv {
  const env = toolEnvironment(source);
  for (const key of Object.keys(env)) {
    if (/^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|PYTHONPATH|PYTHONHOME|VIRTUAL_ENV|CONDA_PREFIX|RUBYLIB|RUBYOPT|PERL5LIB|PERL5OPT|GEM_HOME|GEM_PATH|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|CLASSPATH|RTK_.*)$/i.test(key) || /^npm_config_/i.test(key)) delete env[key];
  }
  const path = Object.entries(env).find(([key]) => key.toUpperCase() === "PATH")?.[1];
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = [nodeDirectory, path].filter(Boolean).join(delimiter);
  env.XDG_CONFIG_HOME = join(directory, "config");
  env.XDG_CACHE_HOME = join(directory, "cache");
  env.XDG_DATA_HOME = join(directory, "data");
  env.XDG_STATE_HOME = join(directory, "state");
  env.APPDATA = join(directory, "config");
  env.LOCALAPPDATA = join(directory, "data");
  env.TMPDIR = env.TMP = env.TEMP = join(directory, "tmp");
  env.npm_config_cache = join(directory, "cache", "npm");
  // Never inherit user/global npm configuration (prefix, registry, scripts, etc.).
  env.npm_config_userconfig = join(directory, "config", "npmrc");
  env.npm_config_globalconfig = join(directory, "config", "npmrc-global");
  env.npm_config_update_notifier = "false";
  env.NO_COLOR = "1";
  return env;
}
export function prepareComponentEnvironment(directory: string) {
  for (const name of ["config", "cache", "data", "state", "tmp"]) mkdirSync(join(directory, name), { recursive: true, mode: 0o700 });
}
/** Supervisor JS belongs to Axiom, not the installed tool's Node runtime. */
export function supervisorEnvironment(source = process.env): NodeJS.ProcessEnv {
  const env = toolEnvironment(source);
  for (const key of Object.keys(env)) if (/^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE)$/i.test(key)) delete env[key];
  return env;
}
