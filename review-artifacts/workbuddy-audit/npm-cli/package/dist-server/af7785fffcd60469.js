var blockedGlobalViolationTypes,cpythonEntryPath,__require=(e=>"u">typeof require?require:"u">typeof Proxy?new Proxy(e,{get:(e,t)=>("u">typeof require?require:e)[t]}):e)(function(e){if("u">typeof require)return require.apply(this,arguments);throw Error('Dynamic require of "'+e+'" is not supported')});import{createRequire as e}from"node:module";import{dirname as t}from"node:path";import{parentPort as r,workerData as o}from"node:worker_threads";function sanitizeWithUnixPrefixes(e,t,r){if(!e)return e;let o=e.replace(/\n\s+at\s.*/g,"");return r&&(o=o.replace(/\bfile:\/\/\/?[^\s'",)}\]:]+/g,"<path>")),o=(o=(o=o.replace(t?/(?:\/(?:Users|home|private|var|opt|Library|System|usr|etc|tmp|nix|snap|workspace|root|srv|mnt|app))\b[^\s'",)}\]:]*/g:/(?:\/(?:Users|home|private|var|opt|Library|System|usr|etc|tmp|nix|snap))\b[^\s'",)}\]:]*/g,"<path>")).replace(/node:internal\/[^\s'",)}\]:]+/g,"<internal>")).replace(/[A-Z]:\\[^\s'",)}\]:]+/g,"<path>"),r&&(o=o.replace(/\\\\[^\s\\]+\\[^\s'",)}\]:]+/g,"<path>")),o}function sanitizeErrorMessage(e){return sanitizeWithUnixPrefixes(e,!1,!1)}function sanitizeHostErrorMessage(e){return sanitizeWithUnixPrefixes(e,!0,!0)}import*as s from"node:async_hooks";import*as i from"node:module";function getBlockedGlobalViolationTypes(){return blockedGlobalViolationTypes||getBlockedGlobals(),blockedGlobalViolationTypes}function getBlockedGlobals(){let e=[{prop:"Function",target:globalThis,violationType:"function_constructor",strategy:"throw",reason:"Function constructor allows arbitrary code execution"},{prop:"eval",target:globalThis,violationType:"eval",strategy:"throw",reason:"eval() allows arbitrary code execution"},{prop:"setTimeout",target:globalThis,violationType:"setTimeout",strategy:"throw",reason:"setTimeout with string argument allows code execution"},{prop:"setInterval",target:globalThis,violationType:"setInterval",strategy:"throw",reason:"setInterval with string argument allows code execution"},{prop:"setImmediate",target:globalThis,violationType:"setImmediate",strategy:"throw",reason:"setImmediate could be used to escape sandbox context"},{prop:"env",target:process,violationType:"process_env",strategy:"throw",reason:"process.env could leak sensitive environment variables",allowedKeys:new Set(["NODE_V8_COVERAGE","NODE_DEBUG","NODE_DEBUG_NATIVE","NODE_COMPILE_CACHE","NODE_ENV","WATCH_REPORT_DEPENDENCIES","FORCE_COLOR","DEBUG","UNDICI_NO_FG","JEST_WORKER_ID","__MINIMATCH_TESTING_PLATFORM__","LOG_TOKENS","LOG_STREAM"])},{prop:"binding",target:process,violationType:"process_binding",strategy:"throw",reason:"process.binding provides access to native Node.js modules"},{prop:"_linkedBinding",target:process,violationType:"process_binding",strategy:"throw",reason:"process._linkedBinding provides access to native Node.js modules"},{prop:"dlopen",target:process,violationType:"process_dlopen",strategy:"throw",reason:"process.dlopen allows loading native addons"},{prop:"getBuiltinModule",target:process,violationType:"process_get_builtin_module",strategy:"throw",reason:"process.getBuiltinModule allows loading native Node.js modules (fs, child_process, vm)"},{prop:"exit",target:process,violationType:"process_exit",strategy:"throw",reason:"process.exit could terminate the interpreter"},{prop:"abort",target:process,violationType:"process_exit",strategy:"throw",reason:"process.abort could crash the interpreter"},{prop:"kill",target:process,violationType:"process_kill",strategy:"throw",reason:"process.kill could signal other processes"},{prop:"setuid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setuid could escalate privileges"},{prop:"setgid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setgid could escalate privileges"},{prop:"seteuid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.seteuid could escalate effective user privileges"},{prop:"setegid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setegid could escalate effective group privileges"},{prop:"initgroups",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.initgroups could modify supplementary group IDs"},{prop:"setgroups",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setgroups could modify supplementary group IDs"},{prop:"umask",target:process,violationType:"process_umask",strategy:"throw",reason:"process.umask could modify file creation permissions"},{prop:"argv",target:process,violationType:"process_argv",strategy:"throw",reason:"process.argv may contain secrets in CLI arguments"},{prop:"cwd",target:process,violationType:"process_chdir",strategy:"throw",reason:"process.cwd could disclose real host working directory path"},{prop:"chdir",target:process,violationType:"process_chdir",strategy:"throw",reason:"process.chdir could confuse the interpreter's CWD tracking"},{prop:"report",target:process,violationType:"process_report",strategy:"throw",reason:"process.report could disclose full environment, host paths, and system info"},{prop:"loadEnvFile",target:process,violationType:"process_env",strategy:"throw",reason:"process.loadEnvFile could load env files bypassing env proxy"},{prop:"setUncaughtExceptionCaptureCallback",target:process,violationType:"process_exception_handler",strategy:"throw",reason:"setUncaughtExceptionCaptureCallback could intercept security errors"},...["on","once","addListener","prependListener","prependOnceListener"].map(e=>({prop:e,target:process,violationType:"process_exception_handler",strategy:"throw",reason:"process-global listeners can outlive the sandbox and lose its security context"})),{prop:"send",target:process,violationType:"process_send",strategy:"throw",reason:"process.send could communicate with parent process in IPC contexts"},{prop:"channel",target:process,violationType:"process_channel",strategy:"throw",reason:"process.channel could access IPC channel to parent process"},{prop:"cpuUsage",target:process,violationType:"process_timing",strategy:"throw",reason:"process.cpuUsage could enable timing side-channel attacks"},{prop:"memoryUsage",target:process,violationType:"process_timing",strategy:"throw",reason:"process.memoryUsage could enable timing side-channel attacks"},{prop:"hrtime",target:process,violationType:"process_timing",strategy:"throw",reason:"process.hrtime could enable timing side-channel attacks"},{prop:"WeakRef",target:globalThis,violationType:"weak_ref",strategy:"throw",reason:"WeakRef could be used to leak references outside sandbox"},{prop:"FinalizationRegistry",target:globalThis,violationType:"finalization_registry",strategy:"throw",reason:"FinalizationRegistry could be used to leak references outside sandbox"},{prop:"Reflect",target:globalThis,violationType:"reflect",strategy:"freeze",reason:"Reflect provides introspection capabilities"},{prop:"Proxy",target:globalThis,violationType:"proxy",strategy:"throw",reason:"Proxy allows intercepting and modifying object behavior"},{prop:"WebAssembly",target:globalThis,violationType:"webassembly",strategy:"throw",reason:"WebAssembly allows executing arbitrary compiled code"},{prop:"SharedArrayBuffer",target:globalThis,violationType:"shared_array_buffer",strategy:"throw",reason:"SharedArrayBuffer could enable side-channel communication or timing attacks"},{prop:"Atomics",target:globalThis,violationType:"atomics",strategy:"throw",reason:"Atomics could enable side-channel communication or timing attacks"},{prop:"performance",target:globalThis,violationType:"performance_timing",strategy:"throw",reason:"performance.now() provides sub-millisecond timing for side-channel attacks"},{prop:"stdout",target:process,violationType:"process_stdout",strategy:"throw",reason:"process.stdout could bypass interpreter output to write to host stdout"},{prop:"stderr",target:process,violationType:"process_stderr",strategy:"throw",reason:"process.stderr could bypass interpreter output to write to host stderr"},{prop:"__defineGetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__defineGetter__ allows prototype pollution via getter injection"},{prop:"__defineSetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__defineSetter__ allows prototype pollution via setter injection"},{prop:"__lookupGetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__lookupGetter__ enables introspection for prototype pollution attacks"},{prop:"__lookupSetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__lookupSetter__ enables introspection for prototype pollution attacks"},{prop:"JSON",target:globalThis,violationType:"json_mutation",strategy:"freeze",reason:"Freeze JSON to prevent mutation of parsing/serialization"},{prop:"Math",target:globalThis,violationType:"math_mutation",strategy:"freeze",reason:"Freeze Math to prevent mutation of math utilities"}];try{let t=Object.getPrototypeOf(async()=>{}).constructor;t&&t!==Function&&e.push({prop:"constructor",target:Object.getPrototypeOf(async()=>{}),violationType:"async_function_constructor",strategy:"throw",reason:"AsyncFunction constructor allows arbitrary async code execution"})}catch{}try{let t=Object.getPrototypeOf(function*(){}).constructor;t&&t!==Function&&e.push({prop:"constructor",target:Object.getPrototypeOf(function*(){}),violationType:"generator_function_constructor",strategy:"throw",reason:"GeneratorFunction constructor allows arbitrary generator code execution"})}catch{}try{let t=Object.getPrototypeOf(async function*(){}).constructor;t&&t!==Function&&t!==Object.getPrototypeOf(async()=>{}).constructor&&e.push({prop:"constructor",target:Object.getPrototypeOf(async function*(){}),violationType:"async_generator_function_constructor",strategy:"throw",reason:"AsyncGeneratorFunction constructor allows arbitrary async generator code execution"})}catch{}let t=e.filter(e=>{try{return void 0!==e.target[e.prop]}catch{return!1}});return blockedGlobalViolationTypes??=new Set(t.map(({violationType:e})=>e)),t}var performanceTimeOrigin=performance.timeOrigin,performanceNow=performance.now.bind(performance);function getSafeTimestamp(){return Math.floor(performanceTimeOrigin+performanceNow())}var NON_EXCLUDABLE_VIOLATION_TYPES=new Set(["function_constructor","async_function_constructor","generator_function_constructor","async_generator_function_constructor"]);function assertExcludableViolationTypes(e){let t=e?.find(e=>NON_EXCLUDABLE_VIOLATION_TYPES.has(e));if(t)throw RangeError(`defenseInDepth.excludeViolationTypes cannot disable the non-excludable "${t}" protection`)}var DEFENSE_IN_DEPTH_NOTICE="\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com";function formatViolationErrorMessage(e,t,r){return e+DEFENSE_IN_DEPTH_NOTICE+(r&&!NON_EXCLUDABLE_VIOLATION_TYPES.has(t)?`

If this access is required by trusted host-runtime code, add "${t}" to defenseInDepth.excludeViolationTypes.`:"")}var IS_BROWSER="u">typeof __BROWSER__&&__BROWSER__,AsyncLocalStorageClass=null,nodeModuleApi=null,nodeModuleClass=null;if(!IS_BROWSER)try{AsyncLocalStorageClass=s.AsyncLocalStorage,nodeModuleClass=(nodeModuleApi=i).Module??nodeModuleApi.default??null}catch{}var executionContext=!IS_BROWSER&&AsyncLocalStorageClass?new AsyncLocalStorageClass:null,WORKER_SPECIAL_EXCLUDABLE_VIOLATION_TYPES=new Set(["error_prepare_stack_trace","module_load","module_resolve_filename","process_main_module","process_exec_path","process_connected"]),WorkerSecurityViolationError=class extends Error{constructor(e,t){super(formatViolationErrorMessage(e,t.type,WORKER_SPECIAL_EXCLUDABLE_VIOLATION_TYPES.has(t.type)||getBlockedGlobalViolationTypes().has(t.type))),this.violation=t,this.name="WorkerSecurityViolationError"}violation},MAX_STORED_VIOLATIONS=1e3,nodeModuleClass2=null;try{let e=process.getBuiltinModule,t="function"==typeof e?e("module"):"function"==typeof __require?__require("node:module"):null;if(nodeModuleClass2=t?.Module??t?.default??null,"function"==typeof e){let t=e("worker_threads");if(t?.isMainThread===!1){let t=e("crypto");t?.randomUUID?.()}}}catch{nodeModuleClass2=null}function generateExecutionId(){return"u">typeof crypto&&crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,e=>{let t=16*Math.random()|0;return("x"===e?t:3&t|8).toString(16)})}var WorkerDefenseInDepth=class{config;isActivated=!1;originalDescriptors=[];patchFailures=[];violations=[];executionId;originalProxy;inTrap=!1;constructor(e){assertExcludableViolationTypes(e.excludeViolationTypes),this.originalProxy=Proxy,this.config=e,this.executionId=generateExecutionId(),!1!==e.enabled&&this.activate()}getStats(){return{violationsBlocked:this.violations.length,violations:[...this.violations],isActive:this.isActivated}}clearViolations(){this.violations=[]}getExecutionId(){return this.executionId}deactivate(){this.isActivated&&(this.restorePatches(),this.isActivated=!1)}activate(){if(!this.isActivated)try{this.applyPatches(),this.isActivated=!0}catch(e){throw this.restorePatches(),this.isActivated=!1,e}}getPathForTarget(e,t){return e===globalThis?`globalThis.${t}`:"u">typeof process&&e===process?`process.${t}`:e===Error?`Error.${t}`:e===Function.prototype?`Function.prototype.${t}`:e===Object.prototype?`Object.prototype.${t}`:`<object>.${t}`}recordViolation(e,t,r){let o={timestamp:getSafeTimestamp(),type:e,message:r,path:t,stack:Error().stack,executionId:this.executionId};if(this.violations.length<MAX_STORED_VIOLATIONS&&this.violations.push(o),this.config.onViolation)try{this.config.onViolation(o)}catch(e){console.debug("[WorkerDefenseInDepth] onViolation callback threw:",e instanceof Error?e.message:e)}return o}createBlockingProxy(e,t,r){let o=this,s=this.config.auditMode;return new this.originalProxy(e,{apply(e,i,a){let n=`${t} is blocked in worker context`,c=o.recordViolation(r,t,n);if(!s)throw new WorkerSecurityViolationError(n,c);return Reflect.apply(e,i,a)},construct(e,i,a){let n=`${t} constructor is blocked in worker context`,c=o.recordViolation(r,t,n);if(!s)throw new WorkerSecurityViolationError(n,c);return Reflect.construct(e,i,a)}})}createBlockingObjectProxy(e,t,r,o){let s=this,i=this.config.auditMode;return new this.originalProxy(e,{get(e,a,n){if(s.inTrap||o&&"string"==typeof a&&o.has(a))return Reflect.get(e,a,n);s.inTrap=!0;try{let o=`${t}.${String(a)}`,c=`${o} is blocked in worker context`,l=s.recordViolation(r,o,c);if(!i)throw new WorkerSecurityViolationError(c,l);return Reflect.get(e,a,n)}finally{s.inTrap=!1}},set(e,o,a,n){let setValue=()=>"process.env"===t&&"DEBUG"===o?Reflect.set(e,o,a):Reflect.set(e,o,a,n);if(s.inTrap)return setValue();s.inTrap=!0;try{let e=`${t}.${String(o)}`,a=`${e} modification is blocked in worker context`,n=s.recordViolation(r,e,a);if(!i)throw new WorkerSecurityViolationError(a,n);return setValue()}finally{s.inTrap=!1}},ownKeys(e){if(s.inTrap)return Reflect.ownKeys(e);s.inTrap=!0;try{let o=`${t} enumeration is blocked in worker context`,a=s.recordViolation(r,t,o);if(!i)throw new WorkerSecurityViolationError(o,a);return Reflect.ownKeys(e)}finally{s.inTrap=!1}},getOwnPropertyDescriptor(e,o){if(s.inTrap)return Reflect.getOwnPropertyDescriptor(e,o);s.inTrap=!0;try{let a=`${t}.${String(o)}`,n=`${a} descriptor access is blocked in worker context`,c=s.recordViolation(r,a,n);if(!i)throw new WorkerSecurityViolationError(n,c);return Reflect.getOwnPropertyDescriptor(e,o)}finally{s.inTrap=!1}},has(e,o){if(s.inTrap)return Reflect.has(e,o);s.inTrap=!0;try{let a=`${t}.${String(o)}`,n=`${a} existence check is blocked in worker context`,c=s.recordViolation(r,a,n);if(!i)throw new WorkerSecurityViolationError(n,c);return Reflect.has(e,o)}finally{s.inTrap=!1}},deleteProperty(e,o){if(s.inTrap)return Reflect.deleteProperty(e,o);s.inTrap=!0;try{let a=`${t}.${String(o)}`,n=`${a} deletion is blocked in worker context`,c=s.recordViolation(r,a,n);if(!i)throw new WorkerSecurityViolationError(n,c);return Reflect.deleteProperty(e,o)}finally{s.inTrap=!1}},setPrototypeOf(e,o){if(s.inTrap)return Reflect.setPrototypeOf(e,o);s.inTrap=!0;try{let a=`${t} setPrototypeOf is blocked in worker context`,n=s.recordViolation(r,t,a);if(!i)throw new WorkerSecurityViolationError(a,n);return Reflect.setPrototypeOf(e,o)}finally{s.inTrap=!1}},defineProperty(e,o,a){if(s.inTrap)return Reflect.defineProperty(e,o,a);s.inTrap=!0;try{let n=`${t}.${String(o)}`,c=`${n} defineProperty is blocked in worker context`,l=s.recordViolation(r,n,c);if(!i)throw new WorkerSecurityViolationError(c,l);return Reflect.defineProperty(e,o,a)}finally{s.inTrap=!1}}})}createReadonlyObjectProxy(e,t,r){let o=this.config.auditMode,allowOrThrow=e=>{let s=`${t} ${e} is blocked in worker context`,i=this.recordViolation(r,t,s);if(!o)throw new WorkerSecurityViolationError(s,i)};return new this.originalProxy(e,{set:(e,t,r,o)=>(allowOrThrow("modification"),Reflect.set(e,t,r,o)),defineProperty:(e,t,r)=>(allowOrThrow("defineProperty"),Reflect.defineProperty(e,t,r)),deleteProperty:(e,t)=>(allowOrThrow("deletion"),Reflect.deleteProperty(e,t)),setPrototypeOf:(e,t)=>(allowOrThrow("setPrototypeOf"),Reflect.setPrototypeOf(e,t)),preventExtensions:e=>(allowOrThrow("preventExtensions"),Reflect.preventExtensions(e))})}applyPatches(){this.patchFailures=[];let e=getBlockedGlobals(),t=new Set(this.config.excludeViolationTypes??[]),r=new Set(["on","once","addListener","prependListener","prependOnceListener"]),o=[];for(let s of e)if(!t.has(s.violationType)&&!(s.target===process&&r.has(s.prop))){if("freeze"===s.strategy){o.push(s);continue}this.applyPatch(s)}t.has("function_constructor")||this.protectConstructorChain(t),t.has("error_prepare_stack_trace")||this.protectErrorPrepareStackTrace(),t.has("module_load")||this.protectModuleLoad(),t.has("module_resolve_filename")||this.protectModuleResolveFilename(),t.has("process_main_module")||this.protectProcessMainModule(),t.has("process_exec_path")||this.protectProcessExecPath(),t.has("process_connected")||this.protectProcessConnected(),t.has("proxy")||this.protectProxyRevocable();let s=["Function.prototype.constructor","Module._load","Module._resolveFilename"],i=this.patchFailures.filter(e=>s.includes(e));if(i.length>0)throw this.restorePatches(),Error(`WorkerDefenseInDepth: critical patches failed: ${i.join(", ")}`);for(let e of o)this.applyPatch(e);this.lockWellKnownSymbols()}lockWellKnownSymbols(){let lock=(e,t)=>{try{let r=Object.getOwnPropertyDescriptor(e,t);if(r?.configurable){if("value"in r)return void Object.defineProperty(e,t,{...r,configurable:!1,writable:!1});Object.defineProperty(e,t,{...r,configurable:!1})}}catch{}};for(let e of[Array,Map,Set,RegExp,Promise])lock(e,Symbol.species);for(let e of[Array.prototype,String.prototype,Map.prototype,Set.prototype])lock(e,Symbol.iterator);for(let e of(lock(Symbol.prototype,Symbol.toPrimitive),lock(Date.prototype,Symbol.toPrimitive),[Symbol.match,Symbol.matchAll,Symbol.replace,Symbol.search,Symbol.split]))lock(RegExp.prototype,e);for(let e of(lock(Function.prototype,Symbol.hasInstance),lock(Array.prototype,Symbol.unscopables),[Map.prototype,Set.prototype,Promise.prototype,ArrayBuffer.prototype]))lock(e,Symbol.toStringTag)}protectProxyRevocable(){let e=this,t=this.config.auditMode;try{let r=this.originalProxy.revocable;if("function"!=typeof r)return;let o=Object.getOwnPropertyDescriptor(this.originalProxy,"revocable");this.originalDescriptors.push({target:this.originalProxy,prop:"revocable",descriptor:o}),Object.defineProperty(this.originalProxy,"revocable",{value:function(o,s){let i="Proxy.revocable is blocked in worker context",a=e.recordViolation("proxy","Proxy.revocable",i);if(!t)throw new WorkerSecurityViolationError(i,a);return r(o,s)},writable:!1,configurable:!0})}catch{}}protectConstructorChain(e){let t=null,r=null,o=null;try{t=Object.getPrototypeOf(async()=>{}).constructor}catch{}try{r=Object.getPrototypeOf(function*(){}).constructor}catch{}try{o=Object.getPrototypeOf(async function*(){}).constructor}catch{}this.patchPrototypeConstructor(Function.prototype,"Function.prototype.constructor","function_constructor"),!e.has("async_function_constructor")&&t&&t!==Function&&this.patchPrototypeConstructor(t.prototype,"AsyncFunction.prototype.constructor","async_function_constructor"),!e.has("generator_function_constructor")&&r&&r!==Function&&this.patchPrototypeConstructor(r.prototype,"GeneratorFunction.prototype.constructor","generator_function_constructor"),!e.has("async_generator_function_constructor")&&o&&o!==Function&&o!==t&&this.patchPrototypeConstructor(o.prototype,"AsyncGeneratorFunction.prototype.constructor","async_generator_function_constructor")}protectErrorPrepareStackTrace(){let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(Error,"prepareStackTrace");this.originalDescriptors.push({target:Error,prop:"prepareStackTrace",descriptor:r});let o=r?.value;Object.defineProperty(Error,"prepareStackTrace",{get:()=>o,set(r){let s="Error.prepareStackTrace modification is blocked in worker context",i=e.recordViolation("error_prepare_stack_trace","Error.prepareStackTrace",s);if(!t)throw new WorkerSecurityViolationError(s,i);o=r},configurable:!0})}catch{}}patchPrototypeConstructor(e,t,r){let o=this,s=this.config.auditMode;try{let i=Object.getOwnPropertyDescriptor(e,"constructor");this.originalDescriptors.push({target:e,prop:"constructor",descriptor:i});let a=i?.value,n=a&&"function"==typeof a?new this.originalProxy(a,{apply(e,i,a){let n=`${t} invocation is blocked in worker context`,c=o.recordViolation(r,t,n);if(!s)throw new WorkerSecurityViolationError(n,c)},construct(e,i,a){let n=`${t} construction is blocked in worker context`,c=o.recordViolation(r,t,n);if(!s)throw new WorkerSecurityViolationError(n,c);return{}},get:(e,t,r)=>Reflect.get(e,t,r),getPrototypeOf:e=>Reflect.getPrototypeOf(e),has:(e,t)=>Reflect.has(e,t),ownKeys:e=>Reflect.ownKeys(e),getOwnPropertyDescriptor:(e,t)=>Reflect.getOwnPropertyDescriptor(e,t)}):a;Object.defineProperty(e,"constructor",{get:()=>n,set(e){let i=`${t} modification is blocked in worker context`,a=o.recordViolation(r,t,i);if(!s)throw new WorkerSecurityViolationError(i,a);Object.defineProperty(this,"constructor",{value:e,writable:!0,configurable:!0})},configurable:!0})}catch{this.patchFailures.push(t)}}protectProcessMainModule(){if("u"<typeof process)return;let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(process,"mainModule");this.originalDescriptors.push({target:process,prop:"mainModule",descriptor:r});let o=r?.value;void 0!==o&&Object.defineProperty(process,"mainModule",{get(){let r="process.mainModule access is blocked in worker context",s=e.recordViolation("process_main_module","process.mainModule",r);if(!t)throw new WorkerSecurityViolationError(r,s);return o},set(r){let o="process.mainModule modification is blocked in worker context",s=e.recordViolation("process_main_module","process.mainModule",o);if(!t)throw new WorkerSecurityViolationError(o,s);Object.defineProperty(process,"mainModule",{value:r,writable:!0,configurable:!0})},configurable:!0})}catch{}}protectProcessExecPath(){if("u"<typeof process)return;let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(process,"execPath");this.originalDescriptors.push({target:process,prop:"execPath",descriptor:r});let o=r?.value??process.execPath;Object.defineProperty(process,"execPath",{get(){let r="process.execPath access is blocked in worker context",s=e.recordViolation("process_exec_path","process.execPath",r);if(!t)throw new WorkerSecurityViolationError(r,s);return o},set(r){let o="process.execPath modification is blocked in worker context",s=e.recordViolation("process_exec_path","process.execPath",o);if(!t)throw new WorkerSecurityViolationError(o,s);Object.defineProperty(process,"execPath",{value:r,writable:!0,configurable:!0})},configurable:!0})}catch{}}protectProcessConnected(){if("u"<typeof process||void 0===process.connected)return;let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(process,"connected");this.originalDescriptors.push({target:process,prop:"connected",descriptor:r});let o=r?.value??process.connected;Object.defineProperty(process,"connected",{get(){let r="process.connected access is blocked in worker context",s=e.recordViolation("process_connected","process.connected",r);if(!t)throw new WorkerSecurityViolationError(r,s);return o},set(r){let o="process.connected modification is blocked in worker context",s=e.recordViolation("process_connected","process.connected",o);if(!t)throw new WorkerSecurityViolationError(o,s);Object.defineProperty(process,"connected",{value:r,writable:!0,configurable:!0})},configurable:!0})}catch{}}protectModuleLoad(){this.protectModuleMethod("_load","module_load")}protectModuleResolveFilename(){this.protectModuleMethod("_resolveFilename","module_resolve_filename")}protectModuleMethod(e,t){let r=`Module.${e}`,o=this,s=this.config.auditMode;try{let i=nodeModuleClass2,a=i?.[e];if(!i||"function"!=typeof a)throw Error("node:module Module class or method is unavailable");let n=Object.getOwnPropertyDescriptor(i,e);if(!n)throw Error("method descriptor is unavailable");if(!1===n.configurable&&!1===n.writable)throw Error("method is non-configurable and non-writable");let c=new this.originalProxy(a,{apply(e,i,a){let n=`${r} is blocked in worker context`,c=o.recordViolation(t,r,n);if(!s)throw new WorkerSecurityViolationError(n,c);return Reflect.apply(e,i,a)}});this.originalDescriptors.push({target:i,prop:e,descriptor:n}),Object.defineProperty(i,e,{...n,value:c});let l=Object.getOwnPropertyDescriptor(i,e);if(i[e]!==c||l?.value!==c)throw Error("installed patch failed verification")}catch{this.patchFailures.push(r)}}applyPatch(e){let{target:t,prop:r,violationType:o,strategy:s}=e;try{let i=t[r];if(void 0===i)return;let a=Object.getOwnPropertyDescriptor(t,r);if(this.originalDescriptors.push({target:t,prop:r,descriptor:a}),"freeze"===s){if("object"==typeof i&&null!==i){Object.freeze(i);let e=this.getPathForTarget(t,r),s=this.createReadonlyObjectProxy(i,e,o);Object.defineProperty(t,r,{...a,value:s})}}else{let s=this.getPathForTarget(t,r),a="function"==typeof i?this.createBlockingProxy(i,s,o):this.createBlockingObjectProxy(i,s,o,e.allowedKeys);Object.defineProperty(t,r,{value:a,writable:!0,configurable:!0})}}catch{}}restorePatches(){for(let e=this.originalDescriptors.length-1;e>=0;e--){let{target:t,prop:r,descriptor:o}=this.originalDescriptors[e];try{o?Object.defineProperty(t,r,o):delete t[r]}catch{}}this.originalDescriptors=[]}};function sanitizeUnknownError(e){return sanitizeErrorMessage(e instanceof Error?e.message:String(e))}function wrapWasmCallback(e,t,r){return(...o)=>{try{return r(...o)}catch(o){let r=sanitizeUnknownError(o);throw Error(`${e} ${t} callback failed: ${r}`)}}}var _SharedArrayBuffer=globalThis.SharedArrayBuffer,_Atomics=globalThis.Atomics,_performanceNow=performance.now.bind(performance),_Headers=globalThis.Headers,_Proxy=globalThis.Proxy,OpCode={NOOP:0,READ_FILE:1,WRITE_FILE:2,STAT:3,READDIR:4,MKDIR:5,RM:6,EXISTS:7,APPEND_FILE:8,SYMLINK:9,READLINK:10,LSTAT:11,CHMOD:12,REALPATH:13,RENAME:14,COPY_FILE:15,WRITE_STDOUT:100,WRITE_STDERR:101,EXIT:102,HTTP_REQUEST:200,EXEC_COMMAND:300,INVOKE_TOOL:400},Status={PENDING:0,READY:1,SUCCESS:2,ERROR:3},ErrorCode={NONE:0,NOT_FOUND:1,IS_DIRECTORY:2,NOT_DIRECTORY:3,EXISTS:4,PERMISSION_DENIED:5,INVALID_PATH:6,IO_ERROR:7,TIMEOUT:8,NETWORK_ERROR:9,NETWORK_NOT_CONFIGURED:10},Offset={OP_CODE:0,STATUS:4,PATH_LENGTH:8,DATA_LENGTH:12,RESULT_LENGTH:16,ERROR_CODE:20,FLAGS:24,MODE:28,PATH_BUFFER:32,DATA_BUFFER:4128},Size={CONTROL_REGION:32,PATH_BUFFER:4096,DATA_BUFFER:8388608,TOTAL:8392736},Flags={NONE:0,RECURSIVE:1,FORCE:2,MKDIR_RECURSIVE:1},StatLayout={IS_FILE:0,IS_DIRECTORY:1,IS_SYMLINK:2,MODE:4,SIZE:8,MTIME:16,TOTAL:24},ProtocolBuffer=class{int32View;uint8View;dataView;constructor(e){this.int32View=new Int32Array(e),this.uint8View=new Uint8Array(e),this.dataView=new DataView(e)}getOpCode(){return _Atomics.load(this.int32View,Offset.OP_CODE/4)}setOpCode(e){_Atomics.store(this.int32View,Offset.OP_CODE/4,e)}getStatus(){return _Atomics.load(this.int32View,Offset.STATUS/4)}setStatus(e){_Atomics.store(this.int32View,Offset.STATUS/4,e)}getPathLength(){return _Atomics.load(this.int32View,Offset.PATH_LENGTH/4)}setPathLength(e){_Atomics.store(this.int32View,Offset.PATH_LENGTH/4,e)}getDataLength(){return _Atomics.load(this.int32View,Offset.DATA_LENGTH/4)}setDataLength(e){_Atomics.store(this.int32View,Offset.DATA_LENGTH/4,e)}getResultLength(){return _Atomics.load(this.int32View,Offset.RESULT_LENGTH/4)}setResultLength(e){_Atomics.store(this.int32View,Offset.RESULT_LENGTH/4,e)}getErrorCode(){return _Atomics.load(this.int32View,Offset.ERROR_CODE/4)}setErrorCode(e){_Atomics.store(this.int32View,Offset.ERROR_CODE/4,e)}getFlags(){return _Atomics.load(this.int32View,Offset.FLAGS/4)}setFlags(e){_Atomics.store(this.int32View,Offset.FLAGS/4,e)}getMode(){return _Atomics.load(this.int32View,Offset.MODE/4)}setMode(e){_Atomics.store(this.int32View,Offset.MODE/4,e)}getPath(){let e=this.getPathLength(),t=this.uint8View.slice(Offset.PATH_BUFFER,Offset.PATH_BUFFER+e);return new TextDecoder().decode(t)}setPath(e){let t=new TextEncoder().encode(e);if(t.length>Size.PATH_BUFFER)throw Error(`Path too long: ${t.length} > ${Size.PATH_BUFFER}`);this.uint8View.set(t,Offset.PATH_BUFFER),this.setPathLength(t.length)}getData(){let e=this.getDataLength();return this.uint8View.slice(Offset.DATA_BUFFER,Offset.DATA_BUFFER+e)}setData(e){if(e.length>Size.DATA_BUFFER)throw Error(`Data too large: ${e.length} > ${Size.DATA_BUFFER}`);this.uint8View.set(e,Offset.DATA_BUFFER),this.setDataLength(e.length)}getDataAsString(){let e=this.getData();return new TextDecoder().decode(e)}setDataFromString(e){let t=new TextEncoder().encode(e);this.setData(t)}getResult(){let e=this.getResultLength();return this.uint8View.slice(Offset.DATA_BUFFER,Offset.DATA_BUFFER+e)}setResult(e){if(e.length>Size.DATA_BUFFER)throw Error(`Result too large: ${e.length} > ${Size.DATA_BUFFER}`);this.uint8View.set(e,Offset.DATA_BUFFER),this.setResultLength(e.length)}getResultAsString(){let e=this.getResult();return new TextDecoder().decode(e)}setResultFromString(e){let t=new TextEncoder().encode(e);this.setResult(t)}encodeStat(e){this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_FILE]=+!!e.isFile,this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_DIRECTORY]=+!!e.isDirectory,this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_SYMLINK]=+!!e.isSymbolicLink,this.dataView.setInt32(Offset.DATA_BUFFER+StatLayout.MODE,e.mode,!0);let t=Math.min(e.size,Number.MAX_SAFE_INTEGER);this.dataView.setFloat64(Offset.DATA_BUFFER+StatLayout.SIZE,t,!0),this.dataView.setFloat64(Offset.DATA_BUFFER+StatLayout.MTIME,e.mtime.getTime(),!0),this.setResultLength(StatLayout.TOTAL)}decodeStat(){return{isFile:1===this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_FILE],isDirectory:1===this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_DIRECTORY],isSymbolicLink:1===this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_SYMLINK],mode:this.dataView.getInt32(Offset.DATA_BUFFER+StatLayout.MODE,!0),size:this.dataView.getFloat64(Offset.DATA_BUFFER+StatLayout.SIZE,!0),mtime:new Date(this.dataView.getFloat64(Offset.DATA_BUFFER+StatLayout.MTIME,!0))}}waitForReady(e){return _Atomics.wait(this.int32View,Offset.STATUS/4,Status.PENDING,e)}waitForReadyAsync(e){return _Atomics.waitAsync(this.int32View,Offset.STATUS/4,Status.PENDING,e)}async waitUntilReady(e){let t=Date.now();for(;;){let r=this.getStatus();if(r===Status.READY)return!0;let o=Date.now()-t;if(o>=e)return!1;let s=e-o,i=_Atomics.waitAsync(this.int32View,Offset.STATUS/4,r,s);if(i.async&&"timed-out"===await i.value)return!1}}waitForResult(e){return _Atomics.wait(this.int32View,Offset.STATUS/4,Status.READY,e)}notify(){return _Atomics.notify(this.int32View,Offset.STATUS/4)}reset(){this.setOpCode(OpCode.NOOP),this.setStatus(Status.PENDING),this.setPathLength(0),this.setDataLength(0),this.setResultLength(0),this.setErrorCode(ErrorCode.NONE),this.setFlags(Flags.NONE),this.setMode(0)}},SyncBackend=class{protocol;operationTimeoutMs;constructor(e,t=3e4){this.protocol=new ProtocolBuffer(e),this.operationTimeoutMs=t}execSync(e,t,r,o=0,s=0){return(this.protocol.reset(),this.protocol.setOpCode(e),this.protocol.setPath(t),this.protocol.setFlags(o),this.protocol.setMode(s),r&&this.protocol.setData(r),this.protocol.setStatus(Status.READY),this.protocol.notify(),"timed-out"===this.protocol.waitForResult(this.operationTimeoutMs))?{success:!1,error:"Operation timed out"}:this.protocol.getStatus()===Status.SUCCESS?{success:!0,result:this.protocol.getResult()}:{success:!1,error:this.protocol.getResultAsString()||`Error code: ${this.protocol.getErrorCode()}`}}readFile(e){let t=this.execSync(OpCode.READ_FILE,e);if(!t.success)throw Error(t.error||"Failed to read file");return t.result??new Uint8Array(0)}writeFile(e,t){let r=this.execSync(OpCode.WRITE_FILE,e,t);if(!r.success)throw Error(r.error||"Failed to write file")}stat(e){let t=this.execSync(OpCode.STAT,e);if(!t.success)throw Error(t.error||"Failed to stat");return this.protocol.decodeStat()}lstat(e){let t=this.execSync(OpCode.LSTAT,e);if(!t.success)throw Error(t.error||"Failed to lstat");return this.protocol.decodeStat()}readdir(e){let t=this.execSync(OpCode.READDIR,e);if(!t.success)throw Error(t.error||"Failed to readdir");return JSON.parse(this.protocol.getResultAsString())}mkdir(e,t=!1){let r=t?Flags.MKDIR_RECURSIVE:0,o=this.execSync(OpCode.MKDIR,e,void 0,r);if(!o.success)throw Error(o.error||"Failed to mkdir")}rm(e,t=!1,r=!1){let o=0;t&&(o|=Flags.RECURSIVE),r&&(o|=Flags.FORCE);let s=this.execSync(OpCode.RM,e,void 0,o);if(!s.success)throw Error(s.error||"Failed to rm")}exists(e){let t=this.execSync(OpCode.EXISTS,e);return!!t.success&&t.result?.[0]===1}appendFile(e,t){let r=this.execSync(OpCode.APPEND_FILE,e,t);if(!r.success)throw Error(r.error||"Failed to append file")}symlink(e,t){let r=new TextEncoder().encode(e),o=this.execSync(OpCode.SYMLINK,t,r);if(!o.success)throw Error(o.error||"Failed to symlink")}readlink(e){let t=this.execSync(OpCode.READLINK,e);if(!t.success)throw Error(t.error||"Failed to readlink");return this.protocol.getResultAsString()}chmod(e,t){let r=this.execSync(OpCode.CHMOD,e,void 0,0,t);if(!r.success)throw Error(r.error||"Failed to chmod")}realpath(e){let t=this.execSync(OpCode.REALPATH,e);if(!t.success)throw Error(t.error||"Failed to realpath");return this.protocol.getResultAsString()}rename(e,t){let r=new TextEncoder().encode(t),o=this.execSync(OpCode.RENAME,e,r);if(!o.success)throw Error(o.error||"Failed to rename")}copyFile(e,t){let r=new TextEncoder().encode(t),o=this.execSync(OpCode.COPY_FILE,e,r);if(!o.success)throw Error(o.error||"Failed to copyFile")}writeStdout(e){let t=new TextEncoder().encode(e),r=this.execSync(OpCode.WRITE_STDOUT,"",t);if(!r.success)throw Error(r.error||"Failed to write stdout")}writeStderr(e){let t=new TextEncoder().encode(e),r=this.execSync(OpCode.WRITE_STDERR,"",t);if(!r.success)throw Error(r.error||"Failed to write stderr")}exit(e){this.execSync(OpCode.EXIT,"",void 0,e)}httpRequest(e,t){let r=t?new TextEncoder().encode(JSON.stringify(t)):void 0,o=this.execSync(OpCode.HTTP_REQUEST,e,r);if(!o.success)throw Error(o.error||"HTTP request failed");let s=JSON.parse(new TextDecoder().decode(o.result)),i=s.bodyBase64??"",a=atob(i);return{status:s.status,statusText:s.statusText,headers:s.headers,url:s.url,body:a,bodyBase64:i}}execCommand(e,t){let r=t?new TextEncoder().encode(JSON.stringify({stdin:t})):void 0,o=this.execSync(OpCode.EXEC_COMMAND,e,r);if(!o.success)throw Error(o.error||"Command execution failed");return JSON.parse(new TextDecoder().decode(o.result))}execCommandArgs(e,t){let r=new TextEncoder().encode(JSON.stringify({args:t})),o=this.execSync(OpCode.EXEC_COMMAND,e,r);if(!o.success)throw Error(o.error||"Command execution failed");return JSON.parse(new TextDecoder().decode(o.result))}invokeTool(e,t){let r=t?new TextEncoder().encode(t):void 0,o=this.execSync(OpCode.INVOKE_TOOL,e,r);if(!o.success)throw Error(o.error||"Tool invocation failed");return new TextDecoder().decode(o.result)}};import{readFileSync as a}from"node:fs";var require2=e(__filename),CPYTHON_ENTRY_BASENAME="/vendor/cpython-emscripten/python.cjs",CPYTHON_STDLIB_BASENAME="/vendor/cpython-emscripten/python313.zip",moduleLoadGuardInstalled=!1;function normalizePath(e){return e.replace(/\\/g,"/")}function isApprovedCpythonEntryPath(e){return normalizePath(e).endsWith(CPYTHON_ENTRY_BASENAME)}function isApprovedStdlibZipPath(e){return normalizePath(e).endsWith(CPYTHON_STDLIB_BASENAME)}function assertApprovedPath(e,t){if(!("cpython-entry"===t?isApprovedCpythonEntryPath(e):isApprovedStdlibZipPath(e)))throw Error(`[Defense-in-depth] rejected ${t} path outside approved vendor bundle: ${e}`)}try{let e=require2("node:module");if("function"==typeof e._load&&"function"==typeof e._resolveFilename){let t=e._load,r=e._resolveFilename,o=new Set(["child_process","node:child_process","cluster","node:cluster","dgram","node:dgram","dns","node:dns","net","node:net","tls","node:tls","vm","node:vm","v8","node:v8","inspector","node:inspector","inspector/promises","node:inspector/promises","trace_events","node:trace_events","perf_hooks","node:perf_hooks","worker_threads","node:worker_threads"]);e._load=function(e,...r){if(o.has(e))throw Error(`[Defense-in-depth] require('${e}') is blocked in worker context`);return t.apply(this,[e,...r])},e._resolveFilename=function(e,...t){if(o.has(e))throw Error(`[Defense-in-depth] resolving '${e}' is blocked in worker context`);return r.apply(this,[e,...t])},moduleLoadGuardInstalled=!0}}catch{}try{cpythonEntryPath=require2.resolve("../../../vendor/cpython-emscripten/python.cjs")}catch(e){cpythonEntryPath=t(import.meta.url).replace("file://","")+"/../../../vendor/cpython-emscripten/python.cjs"}assertApprovedPath(cpythonEntryPath,"cpython-entry");var cpythonDir=t(cpythonEntryPath),stdlibZipPath=`${cpythonDir}/python313.zip`;function createHOSTFS(e,t,r,o){let s=Number.isSafeInteger(o)&&o>=0?o:0,i=Object.assign(Object.create(null),{EPERM:63,ENOENT:44,EIO:29,EBADF:8,EAGAIN:6,EACCES:2,EBUSY:10,EEXIST:20,ENOTDIR:54,EISDIR:31,EINVAL:28,EFBIG:27,EMFILE:33,ENOSPC:51,ESPIPE:70,EROFS:69,ENOTEMPTY:55,ENOSYS:52,ENOTSUP:138,ENODATA:42});function realPath(e){let t=[];for(;e.parent!==e;)t.push(e.name),e=e.parent;return t.push(e.mount.opts.root),t.reverse(),r.join(...t)}function tryFSOperation(e){try{return e()}catch(o){let e=o?.message?.toLowerCase()||("string"==typeof o?o.toLowerCase():""),r=i.EIO;throw e.includes("no such file")||e.includes("not found")?r=i.ENOENT:e.includes("is a directory")?r=i.EISDIR:e.includes("not a directory")?r=i.ENOTDIR:e.includes("already exists")?r=i.EEXIST:e.includes("permission")?r=i.EACCES:e.includes("not empty")&&(r=i.ENOTEMPTY),new t.ErrnoError(r)}}function getMode(t){return tryFSOperation(()=>{let r=e.stat(t),o=511&r.mode;return r.isDirectory?o|=16384:r.isSymbolicLink?o|=40960:o|=32768,o})}let a={mount:e=>a.createNode(null,"/",16877,0),createNode(e,r,o,s){if(!t.isDir(o)&&!t.isFile(o)&&!t.isLink(o))throw new t.ErrnoError(i.EINVAL);let n=t.createNode(e,r,o,s);return n.node_ops=a.node_ops,n.stream_ops=a.stream_ops,n},node_ops:{getattr(t){let r=realPath(t);return tryFSOperation(()=>{let o=e.stat(r),s=511&o.mode;return o.isDirectory?s|=16384:o.isSymbolicLink?s|=40960:s|=32768,{dev:1,ino:t.id,mode:s,nlink:1,uid:0,gid:0,rdev:0,size:o.size,atime:o.mtime,mtime:o.mtime,ctime:o.mtime,blksize:4096,blocks:Math.ceil(o.size/512)}})},setattr(r,o){let a=realPath(r),n=o.mode;if(void 0!==n&&(tryFSOperation(()=>e.chmod(a,n)),r.mode=n),void 0!==o.size){if(!Number.isSafeInteger(o.size)||o.size<0||o.size>s)throw new t.ErrnoError(i.EFBIG);tryFSOperation(()=>{let t=e.readFile(a),r=new Uint8Array(o.size);r.set(t.subarray(0,o.size)),e.writeFile(a,r)})}},lookup(e,t){let o=getMode(r.join2(realPath(e),t));return a.createNode(e,t,o)},mknod(r,o,s,i){let n=a.createNode(r,o,s,i),c=realPath(n);return tryFSOperation(()=>{t.isDir(n.mode)?e.mkdir(c,!1):e.writeFile(c,new Uint8Array(0))}),n},rename(t,o,s){let i=realPath(t),a=r.join2(realPath(o),s);tryFSOperation(()=>{let t=e.readFile(i);e.writeFile(a,t),e.rm(i,!1,!1)}),t.name=s},unlink(t,o){let s=r.join2(realPath(t),o);tryFSOperation(()=>e.rm(s,!1,!1))},rmdir(t,o){let s=r.join2(realPath(t),o);tryFSOperation(()=>e.rm(s,!1,!1))},readdir(t){let r=realPath(t);return tryFSOperation(()=>e.readdir(r))},symlink(t,o,s){let i=r.join2(realPath(t),o);tryFSOperation(()=>e.symlink(s,i))},readlink(t){let r=realPath(t);return tryFSOperation(()=>e.readlink(r))}},stream_ops:{open(r){let o,a=realPath(r.node),n=r.flags,c=3&n,l=1===c||2===c,p=(512&n)!=0;if(!t.isDir(r.node.mode)){try{o=p&&l?new Uint8Array(0):e.readFile(a)}catch(e){if((64&n)!=0&&l)o=new Uint8Array(0);else throw new t.ErrnoError(i.ENOENT)}if(o.length>s)throw new t.ErrnoError(i.EFBIG);r.hostContent=o,r.hostModified=p&&l,r.hostPath=a,(1024&n)!=0&&(r.position=o.length)}},close(t){let r=t.hostPath,o=t.hostContent;t.hostModified&&o&&r&&tryFSOperation(()=>e.writeFile(r,o)),delete t.hostContent,delete t.hostModified,delete t.hostPath},read(e,t,r,o,s){let i=e.hostContent;if(!i)return 0;let a=i.length;if(s>=a)return 0;let n=Math.min(o,a-s);return t.set(i.subarray(s,s+n),r),n},write(e,r,o,a,n){if(!Number.isSafeInteger(n)||!Number.isSafeInteger(a)||!Number.isSafeInteger(o)||n<0||a<0||o<0||a>r.length-o||n>s-a)throw new t.ErrnoError(i.EFBIG);let c=e.hostContent||new Uint8Array(0),l=Math.max(c.length,n+a);if(l>c.length){let t=new Uint8Array(l);t.set(c),e.hostContent=c=t}return c.set(r.subarray(o,o+a),n),e.hostModified=!0,a},llseek(e,r,o){if(0!==o&&1!==o&&2!==o)throw new t.ErrnoError(i.EINVAL);let a=r;if(1===o)a+=e.position;else if(2===o&&t.isFile(e.node.mode)){let t=e.hostContent;a+=t?t.length:0}if(!Number.isSafeInteger(a)||a<0||a>s)throw new t.ErrnoError(i.EINVAL);return a}}};return a}function generateSetupCode(e){let t=Object.entries(e.env).map(([e,t])=>`os.environ[${JSON.stringify(e)}] = ${JSON.stringify(t)}`).join("\n"),r=[e.scriptPath||"python3",...e.args].map(e=>JSON.stringify(e)).join(", ");return`
import os
import sys
import json

${t}

sys.argv = [${r}]

# Path redirection: redirect /absolute paths to /host mount
def _should_redirect(path):
    return (isinstance(path, str) and
            path.startswith('/') and
            not path.startswith('/lib') and
            not path.startswith('/proc') and
            not path.startswith('/host') and
            not path.startswith('/_jb_http'))

# builtins.open
import builtins
_orig_open = builtins.open
def _redir_open(path, mode='r', *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_open(path, mode, *args, **kwargs)
builtins.open = _redir_open

# os file operations
_orig_listdir = os.listdir
def _redir_listdir(path='.'):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_listdir(path)
os.listdir = _redir_listdir

_orig_exists = os.path.exists
def _redir_exists(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_exists(path)
os.path.exists = _redir_exists

_orig_isfile = os.path.isfile
def _redir_isfile(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_isfile(path)
os.path.isfile = _redir_isfile

_orig_isdir = os.path.isdir
def _redir_isdir(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_isdir(path)
os.path.isdir = _redir_isdir

_orig_stat = os.stat
def _redir_stat(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_stat(path, *args, **kwargs)
os.stat = _redir_stat

_orig_mkdir = os.mkdir
def _redir_mkdir(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_mkdir(path, *args, **kwargs)
os.mkdir = _redir_mkdir

_orig_makedirs = os.makedirs
def _redir_makedirs(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_makedirs(path, *args, **kwargs)
os.makedirs = _redir_makedirs

_orig_remove = os.remove
def _redir_remove(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_remove(path, *args, **kwargs)
os.remove = _redir_remove

_orig_rmdir = os.rmdir
def _redir_rmdir(path, *args, **kwargs):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_rmdir(path, *args, **kwargs)
os.rmdir = _redir_rmdir

_orig_getcwd = os.getcwd
def _redir_getcwd():
    cwd = _orig_getcwd()
    if cwd.startswith('/host'):
        return cwd[5:]
    return cwd
os.getcwd = _redir_getcwd

_orig_chdir = os.chdir
def _redir_chdir(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_chdir(path)
os.chdir = _redir_chdir

# glob
import glob as _glob_module
_orig_glob = _glob_module.glob
def _redir_glob(pathname, *args, **kwargs):
    if _should_redirect(pathname):
        pathname = '/host' + pathname
    return _orig_glob(pathname, *args, **kwargs)
_glob_module.glob = _redir_glob

_orig_iglob = _glob_module.iglob
def _redir_iglob(pathname, *args, **kwargs):
    if _should_redirect(pathname):
        pathname = '/host' + pathname
    return _orig_iglob(pathname, *args, **kwargs)
_glob_module.iglob = _redir_iglob

# os.walk
_orig_walk = os.walk
def _redir_walk(top, *args, **kwargs):
    redirected = False
    if _should_redirect(top):
        top = '/host' + top
        redirected = True
    for dirpath, dirnames, filenames in _orig_walk(top, *args, **kwargs):
        if redirected and dirpath.startswith('/host'):
            dirpath = dirpath[5:] if len(dirpath) > 5 else '/'
        yield dirpath, dirnames, filenames
os.walk = _redir_walk

# os.scandir
_orig_scandir = os.scandir
def _redir_scandir(path='.'):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_scandir(path)
os.scandir = _redir_scandir

# io.open and io.open_code
import io as _io_module
_io_module.open = builtins.open

# runpy uses io.open_code rather than builtins.open/io.open. Redirect it
# separately so code loading keeps the logical path in __file__ and argv.
_orig_open_code = _io_module.open_code
def _redir_open_code(path):
    if _should_redirect(path):
        path = '/host' + path
    return _orig_open_code(path)
_io_module.open_code = _redir_open_code

# shutil
import shutil as _shutil_module

_orig_shutil_copy = _shutil_module.copy
def _redir_shutil_copy(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copy(src, dst, *args, **kwargs)
_shutil_module.copy = _redir_shutil_copy

_orig_shutil_copy2 = _shutil_module.copy2
def _redir_shutil_copy2(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copy2(src, dst, *args, **kwargs)
_shutil_module.copy2 = _redir_shutil_copy2

_orig_shutil_copyfile = _shutil_module.copyfile
def _redir_shutil_copyfile(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copyfile(src, dst, *args, **kwargs)
_shutil_module.copyfile = _redir_shutil_copyfile

_orig_shutil_copytree = _shutil_module.copytree
def _redir_shutil_copytree(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_copytree(src, dst, *args, **kwargs)
_shutil_module.copytree = _redir_shutil_copytree

_orig_shutil_move = _shutil_module.move
def _redir_shutil_move(src, dst, *args, **kwargs):
    if _should_redirect(src): src = '/host' + src
    if _should_redirect(dst): dst = '/host' + dst
    return _orig_shutil_move(src, dst, *args, **kwargs)
_shutil_module.move = _redir_shutil_move

_orig_shutil_rmtree = _shutil_module.rmtree
def _redir_shutil_rmtree(path, *args, **kwargs):
    if _should_redirect(path): path = '/host' + path
    return _orig_shutil_rmtree(path, *args, **kwargs)
_shutil_module.rmtree = _redir_shutil_rmtree

# pathlib.Path
from pathlib import Path

def _redirect_path(p):
    s = str(p)
    if _should_redirect(s):
        return Path('/host' + s)
    return p

Path._orig_stat = Path.stat
def _path_stat(self, *args, **kwargs):
    return _redirect_path(self)._orig_stat(*args, **kwargs)
Path.stat = _path_stat

Path._orig_exists = Path.exists
def _path_exists(self):
    return _redirect_path(self)._orig_exists()
Path.exists = _path_exists

Path._orig_is_file = Path.is_file
def _path_is_file(self):
    return _redirect_path(self)._orig_is_file()
Path.is_file = _path_is_file

Path._orig_is_dir = Path.is_dir
def _path_is_dir(self):
    return _redirect_path(self)._orig_is_dir()
Path.is_dir = _path_is_dir

Path._orig_open = Path.open
def _path_open(self, *args, **kwargs):
    return _redirect_path(self)._orig_open(*args, **kwargs)
Path.open = _path_open

Path._orig_read_text = Path.read_text
def _path_read_text(self, *args, **kwargs):
    return _redirect_path(self)._orig_read_text(*args, **kwargs)
Path.read_text = _path_read_text

Path._orig_read_bytes = Path.read_bytes
def _path_read_bytes(self):
    return _redirect_path(self)._orig_read_bytes()
Path.read_bytes = _path_read_bytes

Path._orig_write_text = Path.write_text
def _path_write_text(self, *args, **kwargs):
    return _redirect_path(self)._orig_write_text(*args, **kwargs)
Path.write_text = _path_write_text

Path._orig_write_bytes = Path.write_bytes
def _path_write_bytes(self, data):
    return _redirect_path(self)._orig_write_bytes(data)
Path.write_bytes = _path_write_bytes

Path._orig_mkdir = Path.mkdir
def _path_mkdir(self, *args, **kwargs):
    return _redirect_path(self)._orig_mkdir(*args, **kwargs)
Path.mkdir = _path_mkdir

Path._orig_rmdir = Path.rmdir
def _path_rmdir(self):
    return _redirect_path(self)._orig_rmdir()
Path.rmdir = _path_rmdir

Path._orig_unlink = Path.unlink
def _path_unlink(self, *args, **kwargs):
    return _redirect_path(self)._orig_unlink(*args, **kwargs)
Path.unlink = _path_unlink

Path._orig_iterdir = Path.iterdir
def _path_iterdir(self):
    redirected = _redirect_path(self)
    for p in redirected._orig_iterdir():
        s = str(p)
        if s.startswith('/host'):
            yield Path(s[5:])
        else:
            yield p
Path.iterdir = _path_iterdir

Path._orig_glob = Path.glob
def _path_glob(self, pattern):
    redirected = _redirect_path(self)
    for p in redirected._orig_glob(pattern):
        s = str(p)
        if s.startswith('/host'):
            yield Path(s[5:])
        else:
            yield p
Path.glob = _path_glob

Path._orig_rglob = Path.rglob
def _path_rglob(self, pattern):
    redirected = _redirect_path(self)
    for p in redirected._orig_rglob(pattern):
        s = str(p)
        if s.startswith('/host'):
            yield Path(s[5:])
        else:
            yield p
Path.rglob = _path_rglob

# Set cwd to host mount
os.chdir('/host' + ${JSON.stringify(e.cwd)})
`}function createHTTPFS(e,t){let r=null,o=new TextEncoder,s=new TextDecoder,i={mount:e=>i.createNode(null,"/",16877,0),createNode(e,r,o,s){let a=t.createNode(e,r,o,s);return a.node_ops=i.node_ops,a.stream_ops=i.stream_ops,a},node_ops:{getattr(e){let t="/"===e.name||e.parent===e;return{dev:1,ino:e.id,mode:t?16877:33206,nlink:1,uid:0,gid:0,rdev:0,size:r?r.length:0,atime:new Date,mtime:new Date,ctime:new Date,blksize:4096,blocks:0}},setattr(e,t){},lookup:(e,t)=>i.createNode(e,t,33206),mknod:(e,t,r,o)=>i.createNode(e,t,r),rename(){},unlink(){},rmdir(){},readdir:e=>["request"],symlink(){},readlink:e=>""},stream_ops:{open(e){delete e.hostContent,e.hostModified=!1,0==(3&e.flags)&&r&&(e.hostContent=r)},close(t){if(t.hostModified&&t.hostContent){let i=s.decode(t.hostContent);try{let t=JSON.parse(i),s=e.httpRequest(t.url,{method:t.method||"GET",headers:t.headers||void 0,body:t.body||void 0});r=o.encode(JSON.stringify(s))}catch(t){let e=sanitizeHostErrorMessage(t.message);r=o.encode(JSON.stringify({error:e}))}}delete t.hostContent,delete t.hostModified},read(e,t,r,o,s){let i=e.hostContent;if(!i)return 0;let a=i.length;if(s>=a)return 0;let n=Math.min(o,a-s);return t.set(i.subarray(s,s+n),r),n},write(e,t,r,o,s){let i=e.hostContent||new Uint8Array(0),a=Math.max(i.length,s+o);if(a>i.length){let t=new Uint8Array(a);t.set(i),e.hostContent=i=t}return i.set(t.subarray(r,r+o),s),e.hostModified=!0,o},llseek(e,r,o){let s=r;if(1===o)s+=e.position;else if(2===o){let t=e.hostContent;s+=t?t.length:0}if(s<0)throw new t.ErrnoError(28);return s}}};return i}function generateHttpBridgeCode(){return`
# HTTP bridge: jb_http module
# Write request JSON to /_jb_http/request (custom FS triggers HTTP via SharedArrayBuffer)
# Then read response JSON from same path.

import base64 as _base64

class _JbHttpResponse:
    """HTTP response object similar to requests.Response"""
    def __init__(self, data):
        self.status_code = data.get('status', 0)
        self.reason = data.get('statusText', '')
        # @banned-pattern-ignore: Python code, not JavaScript
        self.headers = data.get('headers', {})
        self.url = data.get('url', '')
        self._error = data.get('error')
        b64 = data.get('bodyBase64')
        if b64 is not None:
            self.content = _base64.b64decode(b64)
            self.text = self.content.decode('utf-8', errors='replace')
        else:
            self.content = b''
            self.text = data.get('body', '')

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self._error:
            raise Exception(self._error)
        if not self.ok:
            raise Exception(f"HTTP {self.status_code}: {self.reason}")

class _JbHttp:
    """HTTP client that bridges to just-bash's secureFetch via custom FS"""
    def _do_request(self, method, url, headers=None, body=None):
        import json as _json
        req = _json.dumps({'url': url, 'method': method, 'headers': headers, 'body': body})
        # Write request to HTTPFS \u2014 close triggers the HTTP call synchronously
        with _orig_open('/_jb_http/request', 'w') as f:
            f.write(req)
        # Read response (cached by HTTPFS from the HTTP call above)
        with _orig_open('/_jb_http/request', 'r') as f:
            return _json.loads(f.read())

    def request(self, method, url, headers=None, data=None, json_data=None):
        if json_data is not None:
            data = json.dumps(json_data)
            headers = headers or {}
            headers['Content-Type'] = 'application/json'
        result = self._do_request(method, url, headers, data)
        if 'error' in result and result.get('status') is None:
            raise Exception(result['error'])
        return _JbHttpResponse(result)

    def get(self, url, headers=None, **kwargs):
        return self.request('GET', url, headers=headers, **kwargs)

    def post(self, url, headers=None, data=None, json=None, **kwargs):
        return self.request('POST', url, headers=headers, data=data, json_data=json, **kwargs)

    def put(self, url, headers=None, data=None, json=None, **kwargs):
        return self.request('PUT', url, headers=headers, data=data, json_data=json, **kwargs)

    def delete(self, url, headers=None, **kwargs):
        return self.request('DELETE', url, headers=headers, **kwargs)

    def head(self, url, headers=None, **kwargs):
        return self.request('HEAD', url, headers=headers, **kwargs)

    def patch(self, url, headers=None, data=None, json=None, **kwargs):
        return self.request('PATCH', url, headers=headers, data=data, json_data=json, **kwargs)

import types
jb_http = types.ModuleType('jb_http')
jb_http._client = _JbHttp()
jb_http.get = jb_http._client.get
jb_http.post = jb_http._client.post
jb_http.put = jb_http._client.put
jb_http.delete = jb_http._client.delete
jb_http.head = jb_http._client.head
jb_http.patch = jb_http._client.patch
jb_http.request = jb_http._client.request
jb_http.Response = _JbHttpResponse
sys.modules['jb_http'] = jb_http
`}assertApprovedPath(stdlibZipPath,"cpython-stdlib");var cachedStdlibZip=new Uint8Array(a(stdlibZipPath));function wrapWorkerMessage(e,t){let r=Object.create(null);if(!t||"object"!=typeof t)return r.success=!1,r.error="Worker attempted to post non-object message",r.protocolToken=e,r;for(let[e,o]of Object.entries(t))r[e]=o;return r.protocolToken=e,r}function postWorkerMessage(e,t){try{r?.postMessage(wrapWorkerMessage(e,t))}catch(e){console.debug("[python3-worker] failed to post worker message:",sanitizeUnknownError(e))}}async function runPython(e){let t;if(!moduleLoadGuardInstalled)return{success:!1,error:"Defense-in-depth module-loader guard failed to initialize; refusing to execute Python worker"};let r=new SyncBackend(e.sharedBuffer,e.timeoutMs);assertApprovedPath(cpythonEntryPath,"cpython-entry");let o=require2(cpythonEntryPath),s=!1,i=[],a=[];try{let n=0,c=wrapWasmCallback("python3-worker","stdin",()=>n<e.stdin.length?e.stdin.charCodeAt(n++):null),l=wrapWasmCallback("python3-worker","preRun",e=>{e.FS.init(c),e.FS.mkdirTree("/lib"),e.FS.writeFile("/lib/python313.zip",cachedStdlibZip),e.ENV.PYTHONHOME="/",e.ENV.PYTHONPATH="/lib/python313.zip"}),p=wrapWasmCallback("python3-worker","print",e=>{s?r.writeStdout(`${e}
`):i.push(`${e}
`)}),d=wrapWasmCallback("python3-worker","printErr",e=>{"string"==typeof e&&(e.includes("Could not find platform")||e.includes("LLVM Profile Error"))||(s?r.writeStderr(`${e}
`):a.push(`${e}
`))});t=await o({noInitialRun:!0,preRun:[l],print:p,printErr:d})}catch(t){let e=sanitizeHostErrorMessage(t.message);return{success:!1,error:`Failed to load CPython: ${e}`}}for(let e of(s=!0,i))r.writeStdout(e);for(let e of a)r.writeStderr(e);let n=createHOSTFS(r,t.FS,t.PATH,e.maxFileSize??8388608);try{t.FS.mkdir("/host"),t.FS.mount(n,{root:"/"},"/host")}catch(t){let e=sanitizeHostErrorMessage(t.message);return{success:!1,error:`Failed to mount HOSTFS: ${e}`}}let c=createHTTPFS(r,t.FS);try{t.FS.mkdir("/_jb_http"),t.FS.mount(c,{root:"/"},"/_jb_http")}catch(t){let e=sanitizeHostErrorMessage(t.message);return{success:!1,error:`Failed to mount HTTPFS: ${e}`}}let l=generateSetupCode(e),p=generateHttpBridgeCode(),d=`
import sys
_jb_exit_code = 0
try:
${l.split("\n").map(e=>`    ${e}`).join("\n")}
${p.split("\n").map(e=>`    ${e}`).join("\n")}
${e.pythonCode.split("\n").map(e=>`    ${e}`).join("\n")}
except SystemExit as e:
    _jb_exit_code = e.code if isinstance(e.code, int) else (1 if e.code else 0)
except Exception as e:
    import traceback
    traceback.print_exc()
    _jb_exit_code = 1
sys.exit(_jb_exit_code)
`;try{t.FS.mkdir("/tmp")}catch(e){}let h=new TextEncoder,u="/tmp/_jb_script.py",_=h.encode(d);t.FS.writeFile(u,_);try{activateDefense(e.protocolToken);let o=t.callMain([u]),s=("number"==typeof o?o:0)||process.exitCode||0;return r.exit(s),{success:!0}}catch(t){let e=t.status??process.exitCode??1;return r.exit(e),{success:!0}}}var defense=null;function activateDefense(e){if(defense)return;let t=Date.now;Object.defineProperty(globalThis,"performance",{value:{now:()=>t(),timeOrigin:t()},writable:!0,configurable:!0}),defense=new WorkerDefenseInDepth({excludeViolationTypes:["shared_array_buffer","atomics","performance_timing","module_load","module_resolve_filename"],onViolation:wrapWasmCallback("python3-worker","onViolation",t=>{postWorkerMessage(e,{type:"security-violation",violation:t})})})}process.on("uncaughtException",e=>{if(!activeProtocolToken)return;let t=sanitizeHostErrorMessage(e.message);postWorkerMessage(activeProtocolToken,{success:!1,error:`Worker uncaught exception: ${t}`})});var activeProtocolToken=null;r&&o&&(activeProtocolToken=o.protocolToken,runPython(o).then(e=>{e.defenseStats=defense?.getStats(),postWorkerMessage(o.protocolToken,e)}).catch(e=>{let t=sanitizeUnknownError(e);postWorkerMessage(o.protocolToken,{success:!1,error:t,defenseStats:defense?.getStats()})}));