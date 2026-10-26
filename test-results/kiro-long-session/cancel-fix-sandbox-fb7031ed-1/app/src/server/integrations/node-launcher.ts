import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { componentEnvironment } from "./component-environment.js";

const shell = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
const ps = (s: string) => `'${s.replaceAll("'", "''")}'`;
/** A self-contained launcher: changing the tool runtime never shadows ordinary
 * node/npm commands in the agent shell. State and PATH change only in this child. */
function launcherFiles(prefix: string, node: string, entry: string) {
  const commands = join(prefix, "commands"), wrapper = join(commands, "opencli.cjs");
  const env = componentEnvironment(join(prefix, "environment"), {});
  delete env.PATH;
  // Launchers are deterministic across application restarts. Proxy values come
  // from the tool shell at execution time, never from install-time credentials.
  for (const key of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(key)) delete env[key];
  const code = `const {delimiter}=require('node:path');\nfor(const key of Object.keys(process.env)){if(/^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|PYTHONPATH|PYTHONHOME|VIRTUAL_ENV|CONDA_PREFIX|RUBYLIB|RUBYOPT|PERL5LIB|PERL5OPT|GEM_HOME|GEM_PATH|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|CLASSPATH|RTK_.*)$/i.test(key)||/^npm_config_/i.test(key))delete process.env[key];}\nconst previous=Object.entries(process.env).find(([key])=>key.toUpperCase()==='PATH')?.[1];\nfor(const key of Object.keys(process.env))if(key.toUpperCase()==='PATH')delete process.env[key];\nObject.assign(process.env,${JSON.stringify(env)});\nprocess.env.PATH=${JSON.stringify(dirname(node))}+delimiter+(previous||'');\nprocess.argv.splice(1,1,${JSON.stringify(entry)});\nimport(require('node:url').pathToFileURL(${JSON.stringify(entry)}).href).catch(error=>{console.error(error.message);process.exitCode=1;});\n`;
  if (process.platform !== "win32") return new Map([[wrapper, code], [join(commands, "opencli"), `#!/bin/sh\nunset NODE_OPTIONS NODE_PATH NODE_REPL_EXTERNAL_MODULE\nexec ${shell(node)} ${shell(wrapper)} "$@"\n`]]);
  const cmd = (s: string) => `"${s.replaceAll("%", "%%")}"`;
  return new Map([[wrapper, code], [join(commands, "opencli.cmd"), `@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "NODE_OPTIONS="\r\nset "NODE_PATH="\r\nset "NODE_REPL_EXTERNAL_MODULE="\r\n${cmd(node)} ${cmd(wrapper)} %*\r\nexit /b %errorlevel%\r\n`], [join(commands, "opencli.ps1"), `$keys=@('NODE_OPTIONS','NODE_PATH','NODE_REPL_EXTERNAL_MODULE')\n$saved=@{}\nforeach($key in $keys){$saved[$key]=[System.Environment]::GetEnvironmentVariable($key,'Process')}\n$code=1\ntry {\n  foreach($key in $keys){[System.Environment]::SetEnvironmentVariable($key,$null,'Process')}\n  & ${ps(node)} ${ps(wrapper)} @args\n  $code=$LASTEXITCODE\n} finally {\n  foreach($key in $keys){[System.Environment]::SetEnvironmentVariable($key,$saved[$key],'Process')}\n}\nexit $code\n`]]);
}
export function writeNodeLauncher(prefix: string, node: string, entry: string) {
  mkdirSync(join(prefix, "commands"), { mode: 0o700 });
  for (const [path, text] of launcherFiles(prefix, node, entry)) writeFileSync(path, text, { flag: "wx", mode: 0o700 });
}
export function inspectNodeLauncher(prefix: string, node: string, entry: string) {
  const files = launcherFiles(prefix, node, entry);
  for (const [path, text] of files) {
    if (lstatSync(path).isSymbolicLink() || realpathSync(path) !== path || readFileSync(path, "utf8") !== text) throw Error("OpenCLI 私有运行时入口已变化，请重新安装。");
    accessSync(path, process.platform === "win32" ? constants.R_OK : constants.X_OK);
  }
  return [...files.keys()];
}
