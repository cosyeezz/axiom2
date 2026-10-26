/**
 * Run in a separate Node process, never in the Axiom server. Join a private
 * kill-on-close Job Object BEFORE spawning the probe, so even children whose
 * immediate parent exits remain owned by the job. No inheritable job handle is
 * created: terminating this supervisor closes its sole handle and kills the job.
 * Windows 8+ supports nesting inside an existing job; fail closed if assignment
 * is prohibited by the host job policy. x64/arm64 share the 144-byte layout.
 */
export const windowsEngineSupervisor = String.raw `
const { spawn } = require('node:child_process');
const [koffiPath, file, args] = JSON.parse(process.argv[1]);
let job;
try {
  if (!['x64', 'arm64'].includes(process.arch)) throw Error('Unsupported Windows architecture');
  const koffi = require(koffiPath), kernel = koffi.load('kernel32.dll');
  const create = kernel.func('void * __stdcall CreateJobObjectW(void *attributes, const void *name)');
  const configure = kernel.func('int __stdcall SetInformationJobObject(void *job, int kind, void *info, uint32_t size)');
  const current = kernel.func('void * __stdcall GetCurrentProcess()');
  const assign = kernel.func('int __stdcall AssignProcessToJobObject(void *job, void *process)');
  const lastError = kernel.func('uint32_t __stdcall GetLastError()');
  job = create(null, null);
  if (!job) throw Error('CreateJobObjectW: ' + lastError());
  const limits = Buffer.alloc(144);
  limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
  if (!configure(job, 9, limits, limits.length)) throw Error('SetInformationJobObject: ' + lastError());
  if (!assign(job, current())) throw Error('AssignProcessToJobObject: ' + lastError());
} catch (error) {
  console.error('REA Windows process isolation failed: ' + error.message);
  process.exit(125);
}
const child = spawn(file, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
child.once('error', error => { console.error('REA probe could not start: ' + error.message); process.exit(126); });
// Do not wait for inherited pipes held by grandchildren. Process exit closes the
// job handle, terminating any remaining descendants even after the probe exits.
child.once('exit', code => process.exit(code === null ? 1 : code));
`;
//# sourceMappingURL=rea-engine-windows.js.map