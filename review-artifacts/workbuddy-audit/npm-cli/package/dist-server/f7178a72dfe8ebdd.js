var blockedGlobalViolationTypes,initializationFailure,__require=(e=>"u">typeof require?require:"u">typeof Proxy?new Proxy(e,{get:(e,t)=>("u">typeof require?require:e)[t]}):e)(function(e){if("u">typeof require)return require.apply(this,arguments);throw Error('Dynamic require of "'+e+'" is not supported')});import{stripTypeScriptTypes as e}from"node:module";import{setTimeout as t}from"node:timers/promises";import{parentPort as r}from"node:worker_threads";import{getQuickJS as o}from"quickjs-emscripten";import*as s from"node:async_hooks";import*as n from"node:module";function getBlockedGlobalViolationTypes(){return blockedGlobalViolationTypes||getBlockedGlobals(),blockedGlobalViolationTypes}function getBlockedGlobals(){let e=[{prop:"Function",target:globalThis,violationType:"function_constructor",strategy:"throw",reason:"Function constructor allows arbitrary code execution"},{prop:"eval",target:globalThis,violationType:"eval",strategy:"throw",reason:"eval() allows arbitrary code execution"},{prop:"setTimeout",target:globalThis,violationType:"setTimeout",strategy:"throw",reason:"setTimeout with string argument allows code execution"},{prop:"setInterval",target:globalThis,violationType:"setInterval",strategy:"throw",reason:"setInterval with string argument allows code execution"},{prop:"setImmediate",target:globalThis,violationType:"setImmediate",strategy:"throw",reason:"setImmediate could be used to escape sandbox context"},{prop:"env",target:process,violationType:"process_env",strategy:"throw",reason:"process.env could leak sensitive environment variables",allowedKeys:new Set(["NODE_V8_COVERAGE","NODE_DEBUG","NODE_DEBUG_NATIVE","NODE_COMPILE_CACHE","NODE_ENV","WATCH_REPORT_DEPENDENCIES","FORCE_COLOR","DEBUG","UNDICI_NO_FG","JEST_WORKER_ID","__MINIMATCH_TESTING_PLATFORM__","LOG_TOKENS","LOG_STREAM"])},{prop:"binding",target:process,violationType:"process_binding",strategy:"throw",reason:"process.binding provides access to native Node.js modules"},{prop:"_linkedBinding",target:process,violationType:"process_binding",strategy:"throw",reason:"process._linkedBinding provides access to native Node.js modules"},{prop:"dlopen",target:process,violationType:"process_dlopen",strategy:"throw",reason:"process.dlopen allows loading native addons"},{prop:"getBuiltinModule",target:process,violationType:"process_get_builtin_module",strategy:"throw",reason:"process.getBuiltinModule allows loading native Node.js modules (fs, child_process, vm)"},{prop:"exit",target:process,violationType:"process_exit",strategy:"throw",reason:"process.exit could terminate the interpreter"},{prop:"abort",target:process,violationType:"process_exit",strategy:"throw",reason:"process.abort could crash the interpreter"},{prop:"kill",target:process,violationType:"process_kill",strategy:"throw",reason:"process.kill could signal other processes"},{prop:"setuid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setuid could escalate privileges"},{prop:"setgid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setgid could escalate privileges"},{prop:"seteuid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.seteuid could escalate effective user privileges"},{prop:"setegid",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setegid could escalate effective group privileges"},{prop:"initgroups",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.initgroups could modify supplementary group IDs"},{prop:"setgroups",target:process,violationType:"process_setuid",strategy:"throw",reason:"process.setgroups could modify supplementary group IDs"},{prop:"umask",target:process,violationType:"process_umask",strategy:"throw",reason:"process.umask could modify file creation permissions"},{prop:"argv",target:process,violationType:"process_argv",strategy:"throw",reason:"process.argv may contain secrets in CLI arguments"},{prop:"cwd",target:process,violationType:"process_chdir",strategy:"throw",reason:"process.cwd could disclose real host working directory path"},{prop:"chdir",target:process,violationType:"process_chdir",strategy:"throw",reason:"process.chdir could confuse the interpreter's CWD tracking"},{prop:"report",target:process,violationType:"process_report",strategy:"throw",reason:"process.report could disclose full environment, host paths, and system info"},{prop:"loadEnvFile",target:process,violationType:"process_env",strategy:"throw",reason:"process.loadEnvFile could load env files bypassing env proxy"},{prop:"setUncaughtExceptionCaptureCallback",target:process,violationType:"process_exception_handler",strategy:"throw",reason:"setUncaughtExceptionCaptureCallback could intercept security errors"},...["on","once","addListener","prependListener","prependOnceListener"].map(e=>({prop:e,target:process,violationType:"process_exception_handler",strategy:"throw",reason:"process-global listeners can outlive the sandbox and lose its security context"})),{prop:"send",target:process,violationType:"process_send",strategy:"throw",reason:"process.send could communicate with parent process in IPC contexts"},{prop:"channel",target:process,violationType:"process_channel",strategy:"throw",reason:"process.channel could access IPC channel to parent process"},{prop:"cpuUsage",target:process,violationType:"process_timing",strategy:"throw",reason:"process.cpuUsage could enable timing side-channel attacks"},{prop:"memoryUsage",target:process,violationType:"process_timing",strategy:"throw",reason:"process.memoryUsage could enable timing side-channel attacks"},{prop:"hrtime",target:process,violationType:"process_timing",strategy:"throw",reason:"process.hrtime could enable timing side-channel attacks"},{prop:"WeakRef",target:globalThis,violationType:"weak_ref",strategy:"throw",reason:"WeakRef could be used to leak references outside sandbox"},{prop:"FinalizationRegistry",target:globalThis,violationType:"finalization_registry",strategy:"throw",reason:"FinalizationRegistry could be used to leak references outside sandbox"},{prop:"Reflect",target:globalThis,violationType:"reflect",strategy:"freeze",reason:"Reflect provides introspection capabilities"},{prop:"Proxy",target:globalThis,violationType:"proxy",strategy:"throw",reason:"Proxy allows intercepting and modifying object behavior"},{prop:"WebAssembly",target:globalThis,violationType:"webassembly",strategy:"throw",reason:"WebAssembly allows executing arbitrary compiled code"},{prop:"SharedArrayBuffer",target:globalThis,violationType:"shared_array_buffer",strategy:"throw",reason:"SharedArrayBuffer could enable side-channel communication or timing attacks"},{prop:"Atomics",target:globalThis,violationType:"atomics",strategy:"throw",reason:"Atomics could enable side-channel communication or timing attacks"},{prop:"performance",target:globalThis,violationType:"performance_timing",strategy:"throw",reason:"performance.now() provides sub-millisecond timing for side-channel attacks"},{prop:"stdout",target:process,violationType:"process_stdout",strategy:"throw",reason:"process.stdout could bypass interpreter output to write to host stdout"},{prop:"stderr",target:process,violationType:"process_stderr",strategy:"throw",reason:"process.stderr could bypass interpreter output to write to host stderr"},{prop:"__defineGetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__defineGetter__ allows prototype pollution via getter injection"},{prop:"__defineSetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__defineSetter__ allows prototype pollution via setter injection"},{prop:"__lookupGetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__lookupGetter__ enables introspection for prototype pollution attacks"},{prop:"__lookupSetter__",target:Object.prototype,violationType:"prototype_mutation",strategy:"throw",reason:"__lookupSetter__ enables introspection for prototype pollution attacks"},{prop:"JSON",target:globalThis,violationType:"json_mutation",strategy:"freeze",reason:"Freeze JSON to prevent mutation of parsing/serialization"},{prop:"Math",target:globalThis,violationType:"math_mutation",strategy:"freeze",reason:"Freeze Math to prevent mutation of math utilities"}];try{let t=Object.getPrototypeOf(async()=>{}).constructor;t&&t!==Function&&e.push({prop:"constructor",target:Object.getPrototypeOf(async()=>{}),violationType:"async_function_constructor",strategy:"throw",reason:"AsyncFunction constructor allows arbitrary async code execution"})}catch{}try{let t=Object.getPrototypeOf(function*(){}).constructor;t&&t!==Function&&e.push({prop:"constructor",target:Object.getPrototypeOf(function*(){}),violationType:"generator_function_constructor",strategy:"throw",reason:"GeneratorFunction constructor allows arbitrary generator code execution"})}catch{}try{let t=Object.getPrototypeOf(async function*(){}).constructor;t&&t!==Function&&t!==Object.getPrototypeOf(async()=>{}).constructor&&e.push({prop:"constructor",target:Object.getPrototypeOf(async function*(){}),violationType:"async_generator_function_constructor",strategy:"throw",reason:"AsyncGeneratorFunction constructor allows arbitrary async generator code execution"})}catch{}let t=e.filter(e=>{try{return void 0!==e.target[e.prop]}catch{return!1}});return blockedGlobalViolationTypes??=new Set(t.map(({violationType:e})=>e)),t}var performanceTimeOrigin=performance.timeOrigin,performanceNow=performance.now.bind(performance);function getSafeTimestamp(){return Math.floor(performanceTimeOrigin+performanceNow())}var NON_EXCLUDABLE_VIOLATION_TYPES=new Set(["function_constructor","async_function_constructor","generator_function_constructor","async_generator_function_constructor"]);function assertExcludableViolationTypes(e){let t=e?.find(e=>NON_EXCLUDABLE_VIOLATION_TYPES.has(e));if(t)throw RangeError(`defenseInDepth.excludeViolationTypes cannot disable the non-excludable "${t}" protection`)}var DEFENSE_IN_DEPTH_NOTICE="\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com";function formatViolationErrorMessage(e,t,r){return e+DEFENSE_IN_DEPTH_NOTICE+(r&&!NON_EXCLUDABLE_VIOLATION_TYPES.has(t)?`

If this access is required by trusted host-runtime code, add "${t}" to defenseInDepth.excludeViolationTypes.`:"")}var IS_BROWSER="u">typeof __BROWSER__&&__BROWSER__,AsyncLocalStorageClass=null,nodeModuleApi=null,nodeModuleClass=null;if(!IS_BROWSER)try{AsyncLocalStorageClass=s.AsyncLocalStorage,nodeModuleClass=(nodeModuleApi=n).Module??nodeModuleApi.default??null}catch{}var executionContext=!IS_BROWSER&&AsyncLocalStorageClass?new AsyncLocalStorageClass:null,WORKER_SPECIAL_EXCLUDABLE_VIOLATION_TYPES=new Set(["error_prepare_stack_trace","module_load","module_resolve_filename","process_main_module","process_exec_path","process_connected"]),WorkerSecurityViolationError=class extends Error{constructor(e,t){super(formatViolationErrorMessage(e,t.type,WORKER_SPECIAL_EXCLUDABLE_VIOLATION_TYPES.has(t.type)||getBlockedGlobalViolationTypes().has(t.type))),this.violation=t,this.name="WorkerSecurityViolationError"}violation},MAX_STORED_VIOLATIONS=1e3,nodeModuleClass2=null;try{let e=process.getBuiltinModule,t="function"==typeof e?e("module"):"function"==typeof __require?__require("node:module"):null;if(nodeModuleClass2=t?.Module??t?.default??null,"function"==typeof e){let t=e("worker_threads");if(t?.isMainThread===!1){let t=e("crypto");t?.randomUUID?.()}}}catch{nodeModuleClass2=null}function generateExecutionId(){return"u">typeof crypto&&crypto.randomUUID?crypto.randomUUID():"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,e=>{let t=16*Math.random()|0;return("x"===e?t:3&t|8).toString(16)})}var WorkerDefenseInDepth=class{config;isActivated=!1;originalDescriptors=[];patchFailures=[];violations=[];executionId;originalProxy;inTrap=!1;constructor(e){assertExcludableViolationTypes(e.excludeViolationTypes),this.originalProxy=Proxy,this.config=e,this.executionId=generateExecutionId(),!1!==e.enabled&&this.activate()}getStats(){return{violationsBlocked:this.violations.length,violations:[...this.violations],isActive:this.isActivated}}clearViolations(){this.violations=[]}getExecutionId(){return this.executionId}deactivate(){this.isActivated&&(this.restorePatches(),this.isActivated=!1)}activate(){if(!this.isActivated)try{this.applyPatches(),this.isActivated=!0}catch(e){throw this.restorePatches(),this.isActivated=!1,e}}getPathForTarget(e,t){return e===globalThis?`globalThis.${t}`:"u">typeof process&&e===process?`process.${t}`:e===Error?`Error.${t}`:e===Function.prototype?`Function.prototype.${t}`:e===Object.prototype?`Object.prototype.${t}`:`<object>.${t}`}recordViolation(e,t,r){let o={timestamp:getSafeTimestamp(),type:e,message:r,path:t,stack:Error().stack,executionId:this.executionId};if(this.violations.length<MAX_STORED_VIOLATIONS&&this.violations.push(o),this.config.onViolation)try{this.config.onViolation(o)}catch(e){console.debug("[WorkerDefenseInDepth] onViolation callback threw:",e instanceof Error?e.message:e)}return o}createBlockingProxy(e,t,r){let o=this,s=this.config.auditMode;return new this.originalProxy(e,{apply(e,n,i){let a=`${t} is blocked in worker context`,c=o.recordViolation(r,t,a);if(!s)throw new WorkerSecurityViolationError(a,c);return Reflect.apply(e,n,i)},construct(e,n,i){let a=`${t} constructor is blocked in worker context`,c=o.recordViolation(r,t,a);if(!s)throw new WorkerSecurityViolationError(a,c);return Reflect.construct(e,n,i)}})}createBlockingObjectProxy(e,t,r,o){let s=this,n=this.config.auditMode;return new this.originalProxy(e,{get(e,i,a){if(s.inTrap||o&&"string"==typeof i&&o.has(i))return Reflect.get(e,i,a);s.inTrap=!0;try{let o=`${t}.${String(i)}`,c=`${o} is blocked in worker context`,l=s.recordViolation(r,o,c);if(!n)throw new WorkerSecurityViolationError(c,l);return Reflect.get(e,i,a)}finally{s.inTrap=!1}},set(e,o,i,a){let setValue=()=>"process.env"===t&&"DEBUG"===o?Reflect.set(e,o,i):Reflect.set(e,o,i,a);if(s.inTrap)return setValue();s.inTrap=!0;try{let e=`${t}.${String(o)}`,i=`${e} modification is blocked in worker context`,a=s.recordViolation(r,e,i);if(!n)throw new WorkerSecurityViolationError(i,a);return setValue()}finally{s.inTrap=!1}},ownKeys(e){if(s.inTrap)return Reflect.ownKeys(e);s.inTrap=!0;try{let o=`${t} enumeration is blocked in worker context`,i=s.recordViolation(r,t,o);if(!n)throw new WorkerSecurityViolationError(o,i);return Reflect.ownKeys(e)}finally{s.inTrap=!1}},getOwnPropertyDescriptor(e,o){if(s.inTrap)return Reflect.getOwnPropertyDescriptor(e,o);s.inTrap=!0;try{let i=`${t}.${String(o)}`,a=`${i} descriptor access is blocked in worker context`,c=s.recordViolation(r,i,a);if(!n)throw new WorkerSecurityViolationError(a,c);return Reflect.getOwnPropertyDescriptor(e,o)}finally{s.inTrap=!1}},has(e,o){if(s.inTrap)return Reflect.has(e,o);s.inTrap=!0;try{let i=`${t}.${String(o)}`,a=`${i} existence check is blocked in worker context`,c=s.recordViolation(r,i,a);if(!n)throw new WorkerSecurityViolationError(a,c);return Reflect.has(e,o)}finally{s.inTrap=!1}},deleteProperty(e,o){if(s.inTrap)return Reflect.deleteProperty(e,o);s.inTrap=!0;try{let i=`${t}.${String(o)}`,a=`${i} deletion is blocked in worker context`,c=s.recordViolation(r,i,a);if(!n)throw new WorkerSecurityViolationError(a,c);return Reflect.deleteProperty(e,o)}finally{s.inTrap=!1}},setPrototypeOf(e,o){if(s.inTrap)return Reflect.setPrototypeOf(e,o);s.inTrap=!0;try{let i=`${t} setPrototypeOf is blocked in worker context`,a=s.recordViolation(r,t,i);if(!n)throw new WorkerSecurityViolationError(i,a);return Reflect.setPrototypeOf(e,o)}finally{s.inTrap=!1}},defineProperty(e,o,i){if(s.inTrap)return Reflect.defineProperty(e,o,i);s.inTrap=!0;try{let a=`${t}.${String(o)}`,c=`${a} defineProperty is blocked in worker context`,l=s.recordViolation(r,a,c);if(!n)throw new WorkerSecurityViolationError(c,l);return Reflect.defineProperty(e,o,i)}finally{s.inTrap=!1}}})}createReadonlyObjectProxy(e,t,r){let o=this.config.auditMode,allowOrThrow=e=>{let s=`${t} ${e} is blocked in worker context`,n=this.recordViolation(r,t,s);if(!o)throw new WorkerSecurityViolationError(s,n)};return new this.originalProxy(e,{set:(e,t,r,o)=>(allowOrThrow("modification"),Reflect.set(e,t,r,o)),defineProperty:(e,t,r)=>(allowOrThrow("defineProperty"),Reflect.defineProperty(e,t,r)),deleteProperty:(e,t)=>(allowOrThrow("deletion"),Reflect.deleteProperty(e,t)),setPrototypeOf:(e,t)=>(allowOrThrow("setPrototypeOf"),Reflect.setPrototypeOf(e,t)),preventExtensions:e=>(allowOrThrow("preventExtensions"),Reflect.preventExtensions(e))})}applyPatches(){this.patchFailures=[];let e=getBlockedGlobals(),t=new Set(this.config.excludeViolationTypes??[]),r=new Set(["on","once","addListener","prependListener","prependOnceListener"]),o=[];for(let s of e)if(!t.has(s.violationType)&&!(s.target===process&&r.has(s.prop))){if("freeze"===s.strategy){o.push(s);continue}this.applyPatch(s)}t.has("function_constructor")||this.protectConstructorChain(t),t.has("error_prepare_stack_trace")||this.protectErrorPrepareStackTrace(),t.has("module_load")||this.protectModuleLoad(),t.has("module_resolve_filename")||this.protectModuleResolveFilename(),t.has("process_main_module")||this.protectProcessMainModule(),t.has("process_exec_path")||this.protectProcessExecPath(),t.has("process_connected")||this.protectProcessConnected(),t.has("proxy")||this.protectProxyRevocable();let s=["Function.prototype.constructor","Module._load","Module._resolveFilename"],n=this.patchFailures.filter(e=>s.includes(e));if(n.length>0)throw this.restorePatches(),Error(`WorkerDefenseInDepth: critical patches failed: ${n.join(", ")}`);for(let e of o)this.applyPatch(e);this.lockWellKnownSymbols()}lockWellKnownSymbols(){let lock=(e,t)=>{try{let r=Object.getOwnPropertyDescriptor(e,t);if(r?.configurable){if("value"in r)return void Object.defineProperty(e,t,{...r,configurable:!1,writable:!1});Object.defineProperty(e,t,{...r,configurable:!1})}}catch{}};for(let e of[Array,Map,Set,RegExp,Promise])lock(e,Symbol.species);for(let e of[Array.prototype,String.prototype,Map.prototype,Set.prototype])lock(e,Symbol.iterator);for(let e of(lock(Symbol.prototype,Symbol.toPrimitive),lock(Date.prototype,Symbol.toPrimitive),[Symbol.match,Symbol.matchAll,Symbol.replace,Symbol.search,Symbol.split]))lock(RegExp.prototype,e);for(let e of(lock(Function.prototype,Symbol.hasInstance),lock(Array.prototype,Symbol.unscopables),[Map.prototype,Set.prototype,Promise.prototype,ArrayBuffer.prototype]))lock(e,Symbol.toStringTag)}protectProxyRevocable(){let e=this,t=this.config.auditMode;try{let r=this.originalProxy.revocable;if("function"!=typeof r)return;let o=Object.getOwnPropertyDescriptor(this.originalProxy,"revocable");this.originalDescriptors.push({target:this.originalProxy,prop:"revocable",descriptor:o}),Object.defineProperty(this.originalProxy,"revocable",{value:function(o,s){let n="Proxy.revocable is blocked in worker context",i=e.recordViolation("proxy","Proxy.revocable",n);if(!t)throw new WorkerSecurityViolationError(n,i);return r(o,s)},writable:!1,configurable:!0})}catch{}}protectConstructorChain(e){let t=null,r=null,o=null;try{t=Object.getPrototypeOf(async()=>{}).constructor}catch{}try{r=Object.getPrototypeOf(function*(){}).constructor}catch{}try{o=Object.getPrototypeOf(async function*(){}).constructor}catch{}this.patchPrototypeConstructor(Function.prototype,"Function.prototype.constructor","function_constructor"),!e.has("async_function_constructor")&&t&&t!==Function&&this.patchPrototypeConstructor(t.prototype,"AsyncFunction.prototype.constructor","async_function_constructor"),!e.has("generator_function_constructor")&&r&&r!==Function&&this.patchPrototypeConstructor(r.prototype,"GeneratorFunction.prototype.constructor","generator_function_constructor"),!e.has("async_generator_function_constructor")&&o&&o!==Function&&o!==t&&this.patchPrototypeConstructor(o.prototype,"AsyncGeneratorFunction.prototype.constructor","async_generator_function_constructor")}protectErrorPrepareStackTrace(){let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(Error,"prepareStackTrace");this.originalDescriptors.push({target:Error,prop:"prepareStackTrace",descriptor:r});let o=r?.value;Object.defineProperty(Error,"prepareStackTrace",{get:()=>o,set(r){let s="Error.prepareStackTrace modification is blocked in worker context",n=e.recordViolation("error_prepare_stack_trace","Error.prepareStackTrace",s);if(!t)throw new WorkerSecurityViolationError(s,n);o=r},configurable:!0})}catch{}}patchPrototypeConstructor(e,t,r){let o=this,s=this.config.auditMode;try{let n=Object.getOwnPropertyDescriptor(e,"constructor");this.originalDescriptors.push({target:e,prop:"constructor",descriptor:n});let i=n?.value,a=i&&"function"==typeof i?new this.originalProxy(i,{apply(e,n,i){let a=`${t} invocation is blocked in worker context`,c=o.recordViolation(r,t,a);if(!s)throw new WorkerSecurityViolationError(a,c)},construct(e,n,i){let a=`${t} construction is blocked in worker context`,c=o.recordViolation(r,t,a);if(!s)throw new WorkerSecurityViolationError(a,c);return{}},get:(e,t,r)=>Reflect.get(e,t,r),getPrototypeOf:e=>Reflect.getPrototypeOf(e),has:(e,t)=>Reflect.has(e,t),ownKeys:e=>Reflect.ownKeys(e),getOwnPropertyDescriptor:(e,t)=>Reflect.getOwnPropertyDescriptor(e,t)}):i;Object.defineProperty(e,"constructor",{get:()=>a,set(e){let n=`${t} modification is blocked in worker context`,i=o.recordViolation(r,t,n);if(!s)throw new WorkerSecurityViolationError(n,i);Object.defineProperty(this,"constructor",{value:e,writable:!0,configurable:!0})},configurable:!0})}catch{this.patchFailures.push(t)}}protectProcessMainModule(){if("u"<typeof process)return;let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(process,"mainModule");this.originalDescriptors.push({target:process,prop:"mainModule",descriptor:r});let o=r?.value;void 0!==o&&Object.defineProperty(process,"mainModule",{get(){let r="process.mainModule access is blocked in worker context",s=e.recordViolation("process_main_module","process.mainModule",r);if(!t)throw new WorkerSecurityViolationError(r,s);return o},set(r){let o="process.mainModule modification is blocked in worker context",s=e.recordViolation("process_main_module","process.mainModule",o);if(!t)throw new WorkerSecurityViolationError(o,s);Object.defineProperty(process,"mainModule",{value:r,writable:!0,configurable:!0})},configurable:!0})}catch{}}protectProcessExecPath(){if("u"<typeof process)return;let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(process,"execPath");this.originalDescriptors.push({target:process,prop:"execPath",descriptor:r});let o=r?.value??process.execPath;Object.defineProperty(process,"execPath",{get(){let r="process.execPath access is blocked in worker context",s=e.recordViolation("process_exec_path","process.execPath",r);if(!t)throw new WorkerSecurityViolationError(r,s);return o},set(r){let o="process.execPath modification is blocked in worker context",s=e.recordViolation("process_exec_path","process.execPath",o);if(!t)throw new WorkerSecurityViolationError(o,s);Object.defineProperty(process,"execPath",{value:r,writable:!0,configurable:!0})},configurable:!0})}catch{}}protectProcessConnected(){if("u"<typeof process||void 0===process.connected)return;let e=this,t=this.config.auditMode;try{let r=Object.getOwnPropertyDescriptor(process,"connected");this.originalDescriptors.push({target:process,prop:"connected",descriptor:r});let o=r?.value??process.connected;Object.defineProperty(process,"connected",{get(){let r="process.connected access is blocked in worker context",s=e.recordViolation("process_connected","process.connected",r);if(!t)throw new WorkerSecurityViolationError(r,s);return o},set(r){let o="process.connected modification is blocked in worker context",s=e.recordViolation("process_connected","process.connected",o);if(!t)throw new WorkerSecurityViolationError(o,s);Object.defineProperty(process,"connected",{value:r,writable:!0,configurable:!0})},configurable:!0})}catch{}}protectModuleLoad(){this.protectModuleMethod("_load","module_load")}protectModuleResolveFilename(){this.protectModuleMethod("_resolveFilename","module_resolve_filename")}protectModuleMethod(e,t){let r=`Module.${e}`,o=this,s=this.config.auditMode;try{let n=nodeModuleClass2,i=n?.[e];if(!n||"function"!=typeof i)throw Error("node:module Module class or method is unavailable");let a=Object.getOwnPropertyDescriptor(n,e);if(!a)throw Error("method descriptor is unavailable");if(!1===a.configurable&&!1===a.writable)throw Error("method is non-configurable and non-writable");let c=new this.originalProxy(i,{apply(e,n,i){let a=`${r} is blocked in worker context`,c=o.recordViolation(t,r,a);if(!s)throw new WorkerSecurityViolationError(a,c);return Reflect.apply(e,n,i)}});this.originalDescriptors.push({target:n,prop:e,descriptor:a}),Object.defineProperty(n,e,{...a,value:c});let l=Object.getOwnPropertyDescriptor(n,e);if(n[e]!==c||l?.value!==c)throw Error("installed patch failed verification")}catch{this.patchFailures.push(r)}}applyPatch(e){let{target:t,prop:r,violationType:o,strategy:s}=e;try{let n=t[r];if(void 0===n)return;let i=Object.getOwnPropertyDescriptor(t,r);if(this.originalDescriptors.push({target:t,prop:r,descriptor:i}),"freeze"===s){if("object"==typeof n&&null!==n){Object.freeze(n);let e=this.getPathForTarget(t,r),s=this.createReadonlyObjectProxy(n,e,o);Object.defineProperty(t,r,{...i,value:s})}}else{let s=this.getPathForTarget(t,r),i="function"==typeof n?this.createBlockingProxy(n,s,o):this.createBlockingObjectProxy(n,s,o,e.allowedKeys);Object.defineProperty(t,r,{value:i,writable:!0,configurable:!0})}}catch{}}restorePatches(){for(let e=this.originalDescriptors.length-1;e>=0;e--){let{target:t,prop:r,descriptor:o}=this.originalDescriptors[e];try{o?Object.defineProperty(t,r,o):delete t[r]}catch{}}this.originalDescriptors=[]}},_SharedArrayBuffer=globalThis.SharedArrayBuffer,_Atomics=globalThis.Atomics,_performanceNow=performance.now.bind(performance),_Headers=globalThis.Headers,_Proxy=globalThis.Proxy,OpCode={NOOP:0,READ_FILE:1,WRITE_FILE:2,STAT:3,READDIR:4,MKDIR:5,RM:6,EXISTS:7,APPEND_FILE:8,SYMLINK:9,READLINK:10,LSTAT:11,CHMOD:12,REALPATH:13,RENAME:14,COPY_FILE:15,WRITE_STDOUT:100,WRITE_STDERR:101,EXIT:102,HTTP_REQUEST:200,EXEC_COMMAND:300,INVOKE_TOOL:400},Status={PENDING:0,READY:1,SUCCESS:2,ERROR:3},ErrorCode={NONE:0,NOT_FOUND:1,IS_DIRECTORY:2,NOT_DIRECTORY:3,EXISTS:4,PERMISSION_DENIED:5,INVALID_PATH:6,IO_ERROR:7,TIMEOUT:8,NETWORK_ERROR:9,NETWORK_NOT_CONFIGURED:10},Offset={OP_CODE:0,STATUS:4,PATH_LENGTH:8,DATA_LENGTH:12,RESULT_LENGTH:16,ERROR_CODE:20,FLAGS:24,MODE:28,PATH_BUFFER:32,DATA_BUFFER:4128},Size={CONTROL_REGION:32,PATH_BUFFER:4096,DATA_BUFFER:8388608,TOTAL:8392736},Flags={NONE:0,RECURSIVE:1,FORCE:2,MKDIR_RECURSIVE:1},StatLayout={IS_FILE:0,IS_DIRECTORY:1,IS_SYMLINK:2,MODE:4,SIZE:8,MTIME:16,TOTAL:24},ProtocolBuffer=class{int32View;uint8View;dataView;constructor(e){this.int32View=new Int32Array(e),this.uint8View=new Uint8Array(e),this.dataView=new DataView(e)}getOpCode(){return _Atomics.load(this.int32View,Offset.OP_CODE/4)}setOpCode(e){_Atomics.store(this.int32View,Offset.OP_CODE/4,e)}getStatus(){return _Atomics.load(this.int32View,Offset.STATUS/4)}setStatus(e){_Atomics.store(this.int32View,Offset.STATUS/4,e)}getPathLength(){return _Atomics.load(this.int32View,Offset.PATH_LENGTH/4)}setPathLength(e){_Atomics.store(this.int32View,Offset.PATH_LENGTH/4,e)}getDataLength(){return _Atomics.load(this.int32View,Offset.DATA_LENGTH/4)}setDataLength(e){_Atomics.store(this.int32View,Offset.DATA_LENGTH/4,e)}getResultLength(){return _Atomics.load(this.int32View,Offset.RESULT_LENGTH/4)}setResultLength(e){_Atomics.store(this.int32View,Offset.RESULT_LENGTH/4,e)}getErrorCode(){return _Atomics.load(this.int32View,Offset.ERROR_CODE/4)}setErrorCode(e){_Atomics.store(this.int32View,Offset.ERROR_CODE/4,e)}getFlags(){return _Atomics.load(this.int32View,Offset.FLAGS/4)}setFlags(e){_Atomics.store(this.int32View,Offset.FLAGS/4,e)}getMode(){return _Atomics.load(this.int32View,Offset.MODE/4)}setMode(e){_Atomics.store(this.int32View,Offset.MODE/4,e)}getPath(){let e=this.getPathLength(),t=this.uint8View.slice(Offset.PATH_BUFFER,Offset.PATH_BUFFER+e);return new TextDecoder().decode(t)}setPath(e){let t=new TextEncoder().encode(e);if(t.length>Size.PATH_BUFFER)throw Error(`Path too long: ${t.length} > ${Size.PATH_BUFFER}`);this.uint8View.set(t,Offset.PATH_BUFFER),this.setPathLength(t.length)}getData(){let e=this.getDataLength();return this.uint8View.slice(Offset.DATA_BUFFER,Offset.DATA_BUFFER+e)}setData(e){if(e.length>Size.DATA_BUFFER)throw Error(`Data too large: ${e.length} > ${Size.DATA_BUFFER}`);this.uint8View.set(e,Offset.DATA_BUFFER),this.setDataLength(e.length)}getDataAsString(){let e=this.getData();return new TextDecoder().decode(e)}setDataFromString(e){let t=new TextEncoder().encode(e);this.setData(t)}getResult(){let e=this.getResultLength();return this.uint8View.slice(Offset.DATA_BUFFER,Offset.DATA_BUFFER+e)}setResult(e){if(e.length>Size.DATA_BUFFER)throw Error(`Result too large: ${e.length} > ${Size.DATA_BUFFER}`);this.uint8View.set(e,Offset.DATA_BUFFER),this.setResultLength(e.length)}getResultAsString(){let e=this.getResult();return new TextDecoder().decode(e)}setResultFromString(e){let t=new TextEncoder().encode(e);this.setResult(t)}encodeStat(e){this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_FILE]=+!!e.isFile,this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_DIRECTORY]=+!!e.isDirectory,this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_SYMLINK]=+!!e.isSymbolicLink,this.dataView.setInt32(Offset.DATA_BUFFER+StatLayout.MODE,e.mode,!0);let t=Math.min(e.size,Number.MAX_SAFE_INTEGER);this.dataView.setFloat64(Offset.DATA_BUFFER+StatLayout.SIZE,t,!0),this.dataView.setFloat64(Offset.DATA_BUFFER+StatLayout.MTIME,e.mtime.getTime(),!0),this.setResultLength(StatLayout.TOTAL)}decodeStat(){return{isFile:1===this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_FILE],isDirectory:1===this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_DIRECTORY],isSymbolicLink:1===this.uint8View[Offset.DATA_BUFFER+StatLayout.IS_SYMLINK],mode:this.dataView.getInt32(Offset.DATA_BUFFER+StatLayout.MODE,!0),size:this.dataView.getFloat64(Offset.DATA_BUFFER+StatLayout.SIZE,!0),mtime:new Date(this.dataView.getFloat64(Offset.DATA_BUFFER+StatLayout.MTIME,!0))}}waitForReady(e){return _Atomics.wait(this.int32View,Offset.STATUS/4,Status.PENDING,e)}waitForReadyAsync(e){return _Atomics.waitAsync(this.int32View,Offset.STATUS/4,Status.PENDING,e)}async waitUntilReady(e){let t=Date.now();for(;;){let r=this.getStatus();if(r===Status.READY)return!0;let o=Date.now()-t;if(o>=e)return!1;let s=e-o,n=_Atomics.waitAsync(this.int32View,Offset.STATUS/4,r,s);if(n.async&&"timed-out"===await n.value)return!1}}waitForResult(e){return _Atomics.wait(this.int32View,Offset.STATUS/4,Status.READY,e)}notify(){return _Atomics.notify(this.int32View,Offset.STATUS/4)}reset(){this.setOpCode(OpCode.NOOP),this.setStatus(Status.PENDING),this.setPathLength(0),this.setDataLength(0),this.setResultLength(0),this.setErrorCode(ErrorCode.NONE),this.setFlags(Flags.NONE),this.setMode(0)}},SyncBackend=class{protocol;operationTimeoutMs;constructor(e,t=3e4){this.protocol=new ProtocolBuffer(e),this.operationTimeoutMs=t}execSync(e,t,r,o=0,s=0){return(this.protocol.reset(),this.protocol.setOpCode(e),this.protocol.setPath(t),this.protocol.setFlags(o),this.protocol.setMode(s),r&&this.protocol.setData(r),this.protocol.setStatus(Status.READY),this.protocol.notify(),"timed-out"===this.protocol.waitForResult(this.operationTimeoutMs))?{success:!1,error:"Operation timed out"}:this.protocol.getStatus()===Status.SUCCESS?{success:!0,result:this.protocol.getResult()}:{success:!1,error:this.protocol.getResultAsString()||`Error code: ${this.protocol.getErrorCode()}`}}readFile(e){let t=this.execSync(OpCode.READ_FILE,e);if(!t.success)throw Error(t.error||"Failed to read file");return t.result??new Uint8Array(0)}writeFile(e,t){let r=this.execSync(OpCode.WRITE_FILE,e,t);if(!r.success)throw Error(r.error||"Failed to write file")}stat(e){let t=this.execSync(OpCode.STAT,e);if(!t.success)throw Error(t.error||"Failed to stat");return this.protocol.decodeStat()}lstat(e){let t=this.execSync(OpCode.LSTAT,e);if(!t.success)throw Error(t.error||"Failed to lstat");return this.protocol.decodeStat()}readdir(e){let t=this.execSync(OpCode.READDIR,e);if(!t.success)throw Error(t.error||"Failed to readdir");return JSON.parse(this.protocol.getResultAsString())}mkdir(e,t=!1){let r=t?Flags.MKDIR_RECURSIVE:0,o=this.execSync(OpCode.MKDIR,e,void 0,r);if(!o.success)throw Error(o.error||"Failed to mkdir")}rm(e,t=!1,r=!1){let o=0;t&&(o|=Flags.RECURSIVE),r&&(o|=Flags.FORCE);let s=this.execSync(OpCode.RM,e,void 0,o);if(!s.success)throw Error(s.error||"Failed to rm")}exists(e){let t=this.execSync(OpCode.EXISTS,e);return!!t.success&&t.result?.[0]===1}appendFile(e,t){let r=this.execSync(OpCode.APPEND_FILE,e,t);if(!r.success)throw Error(r.error||"Failed to append file")}symlink(e,t){let r=new TextEncoder().encode(e),o=this.execSync(OpCode.SYMLINK,t,r);if(!o.success)throw Error(o.error||"Failed to symlink")}readlink(e){let t=this.execSync(OpCode.READLINK,e);if(!t.success)throw Error(t.error||"Failed to readlink");return this.protocol.getResultAsString()}chmod(e,t){let r=this.execSync(OpCode.CHMOD,e,void 0,0,t);if(!r.success)throw Error(r.error||"Failed to chmod")}realpath(e){let t=this.execSync(OpCode.REALPATH,e);if(!t.success)throw Error(t.error||"Failed to realpath");return this.protocol.getResultAsString()}rename(e,t){let r=new TextEncoder().encode(t),o=this.execSync(OpCode.RENAME,e,r);if(!o.success)throw Error(o.error||"Failed to rename")}copyFile(e,t){let r=new TextEncoder().encode(t),o=this.execSync(OpCode.COPY_FILE,e,r);if(!o.success)throw Error(o.error||"Failed to copyFile")}writeStdout(e){let t=new TextEncoder().encode(e),r=this.execSync(OpCode.WRITE_STDOUT,"",t);if(!r.success)throw Error(r.error||"Failed to write stdout")}writeStderr(e){let t=new TextEncoder().encode(e),r=this.execSync(OpCode.WRITE_STDERR,"",t);if(!r.success)throw Error(r.error||"Failed to write stderr")}exit(e){this.execSync(OpCode.EXIT,"",void 0,e)}httpRequest(e,t){let r=t?new TextEncoder().encode(JSON.stringify(t)):void 0,o=this.execSync(OpCode.HTTP_REQUEST,e,r);if(!o.success)throw Error(o.error||"HTTP request failed");let s=JSON.parse(new TextDecoder().decode(o.result)),n=s.bodyBase64??"",i=atob(n);return{status:s.status,statusText:s.statusText,headers:s.headers,url:s.url,body:i,bodyBase64:n}}execCommand(e,t){let r=t?new TextEncoder().encode(JSON.stringify({stdin:t})):void 0,o=this.execSync(OpCode.EXEC_COMMAND,e,r);if(!o.success)throw Error(o.error||"Command execution failed");return JSON.parse(new TextDecoder().decode(o.result))}execCommandArgs(e,t){let r=new TextEncoder().encode(JSON.stringify({args:t})),o=this.execSync(OpCode.EXEC_COMMAND,e,r);if(!o.success)throw Error(o.error||"Command execution failed");return JSON.parse(new TextDecoder().decode(o.result))}invokeTool(e,t){let r=t?new TextEncoder().encode(t):void 0,o=this.execSync(OpCode.INVOKE_TOOL,e,r);if(!o.success)throw Error(o.error||"Tool invocation failed");return new TextDecoder().decode(o.result)}},FETCH_POLYFILL_SOURCE=`
(function() {
  // --- URLSearchParams ---
  function URLSearchParams(init) {
    this._entries = [];
    if (!init) return;
    if (typeof init === 'string') {
      var s = init;
      if (s.charAt(0) === '?') s = s.slice(1);
      var pairs = s.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        if (pair === '') continue;
        var eq = pair.indexOf('=');
        if (eq === -1) {
          this._entries.push([decodeURIComponent(pair), '']);
        } else {
          this._entries.push([
            decodeURIComponent(pair.slice(0, eq)),
            decodeURIComponent(pair.slice(eq + 1))
          ]);
        }
      }
    } else if (typeof init === 'object' && init !== null) {
      if (init instanceof URLSearchParams) {
        this._entries = init._entries.slice();
      } else {
        var keys = Object.keys(init);
        for (var i = 0; i < keys.length; i++) {
          this._entries.push([keys[i], String(init[keys[i]])]);
        }
      }
    }
  }

  URLSearchParams.prototype.append = function(name, value) {
    this._entries.push([String(name), String(value)]);
  };

  URLSearchParams.prototype.delete = function(name) {
    var n = String(name);
    this._entries = this._entries.filter(function(e) { return e[0] !== n; });
  };

  URLSearchParams.prototype.get = function(name) {
    var n = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) return this._entries[i][1];
    }
    return null;
  };

  URLSearchParams.prototype.getAll = function(name) {
    var n = String(name);
    var result = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) result.push(this._entries[i][1]);
    }
    return result;
  };

  URLSearchParams.prototype.has = function(name) {
    var n = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) return true;
    }
    return false;
  };

  URLSearchParams.prototype.set = function(name, value) {
    var n = String(name);
    var v = String(value);
    var found = false;
    var newEntries = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) {
        if (!found) {
          newEntries.push([n, v]);
          found = true;
        }
      } else {
        newEntries.push(this._entries[i]);
      }
    }
    if (!found) newEntries.push([n, v]);
    this._entries = newEntries;
  };

  URLSearchParams.prototype.sort = function() {
    this._entries.sort(function(a, b) {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });
  };

  URLSearchParams.prototype.toString = function() {
    return this._entries.map(function(e) {
      return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]);
    }).join('&');
  };

  URLSearchParams.prototype.forEach = function(callback, thisArg) {
    for (var i = 0; i < this._entries.length; i++) {
      callback.call(thisArg, this._entries[i][1], this._entries[i][0], this);
    }
  };

  URLSearchParams.prototype.entries = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++].slice() };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype.keys = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++][0] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype.values = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++][1] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;

  Object.defineProperty(URLSearchParams.prototype, 'size', {
    get: function() { return this._entries.length; }
  });

  // --- URL ---
  var urlRegex = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\\/\\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?([^:/?#]*)(?::([0-9]+))?)?(\\/[^?#]*)?(?:\\?([^#]*))?(?:#(.*))?$/;

  function URL(url, base) {
    var input = String(url);

    if (base !== undefined) {
      var baseUrl = (base instanceof URL) ? base : new URL(String(base));
      // Resolve relative URL against base
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
        // Absolute URL - parse as-is
      } else if (input.charAt(0) === '/' && input.charAt(1) === '/') {
        // Protocol-relative
        input = baseUrl.protocol + input;
      } else if (input.charAt(0) === '/') {
        // Absolute path
        input = baseUrl.origin + input;
      } else if (input.charAt(0) === '?' || input.charAt(0) === '#') {
        // Query or hash only
        var basePath = baseUrl.protocol + '//' + baseUrl.host + baseUrl.pathname;
        if (input.charAt(0) === '#') {
          input = basePath + baseUrl.search + input;
        } else {
          input = basePath + input;
        }
      } else {
        // Relative path
        var basePath = baseUrl.protocol + '//' + baseUrl.host;
        var dirPath = baseUrl.pathname;
        var lastSlash = dirPath.lastIndexOf('/');
        if (lastSlash >= 0) dirPath = dirPath.slice(0, lastSlash + 1);
        else dirPath = '/';
        input = basePath + dirPath + input;
      }
    }

    var m = urlRegex.exec(input);
    if (!m) throw new TypeError("Invalid URL: " + String(url));

    this.protocol = m[1].toLowerCase() + ':';
    this.username = m[2] ? decodeURIComponent(m[2]) : '';
    this.password = m[3] ? decodeURIComponent(m[3]) : '';
    this.hostname = m[4] || '';
    this.port = m[5] || '';
    this.pathname = m[6] || '/';
    this.hash = m[8] ? '#' + m[8] : '';

    // Normalize pathname (resolve . and ..)
    var parts = this.pathname.split('/');
    var resolved = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') { if (resolved.length > 1) resolved.pop(); }
      else if (parts[i] !== '.') resolved.push(parts[i]);
    }
    this.pathname = resolved.join('/') || '/';

    // searchParams is live
    this._searchParamsStr = m[7] || '';
    this.searchParams = new URLSearchParams(this._searchParamsStr);
  }

  Object.defineProperty(URL.prototype, 'search', {
    get: function() {
      var s = this.searchParams.toString();
      return s ? '?' + s : '';
    },
    set: function(v) {
      this.searchParams = new URLSearchParams(String(v));
    }
  });

  Object.defineProperty(URL.prototype, 'host', {
    get: function() {
      return this.port ? this.hostname + ':' + this.port : this.hostname;
    }
  });

  Object.defineProperty(URL.prototype, 'origin', {
    get: function() {
      return this.protocol + '//' + this.host;
    }
  });

  Object.defineProperty(URL.prototype, 'href', {
    get: function() {
      var auth = '';
      if (this.username) {
        auth = this.username;
        if (this.password) auth += ':' + this.password;
        auth += '@';
      }
      return this.protocol + '//' + auth + this.host + this.pathname + this.search + this.hash;
    },
    set: function(v) {
      var parsed = new URL(String(v));
      this.protocol = parsed.protocol;
      this.username = parsed.username;
      this.password = parsed.password;
      this.hostname = parsed.hostname;
      this.port = parsed.port;
      this.pathname = parsed.pathname;
      this.searchParams = parsed.searchParams;
      this.hash = parsed.hash;
    }
  });

  URL.prototype.toString = function() { return this.href; };
  URL.prototype.toJSON = function() { return this.href; };

  // --- Headers ---
  function Headers(init) {
    this._map = Object.create(null);
    if (!init) return;
    if (init instanceof Headers) {
      var keys = Object.keys(init._map);
      for (var i = 0; i < keys.length; i++) {
        this._map[keys[i]] = init._map[keys[i]].slice();
      }
    } else if (typeof init === 'object') {
      var keys = Object.keys(init);
      for (var i = 0; i < keys.length; i++) {
        this._map[keys[i].toLowerCase()] = [String(init[keys[i]])];
      }
    }
  }

  Headers.prototype.append = function(name, value) {
    var key = String(name).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(this._map, key)) this._map[key] = [];
    this._map[key].push(String(value));
  };

  Headers.prototype.delete = function(name) {
    delete this._map[String(name).toLowerCase()];
  };

  Headers.prototype.get = function(name) {
    var vals = this._map[String(name).toLowerCase()];
    return vals ? vals.join(', ') : null;
  };

  Headers.prototype.has = function(name) {
    return Object.prototype.hasOwnProperty.call(this._map, String(name).toLowerCase());
  };

  Headers.prototype.set = function(name, value) {
    this._map[String(name).toLowerCase()] = [String(value)];
  };

  Headers.prototype.forEach = function(callback, thisArg) {
    var keys = Object.keys(this._map).sort();
    for (var i = 0; i < keys.length; i++) {
      callback.call(thisArg, this._map[keys[i]].join(', '), keys[i], this);
    }
  };

  Headers.prototype.entries = function() {
    var keys = Object.keys(this._map).sort();
    var map = this._map;
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        var k = keys[idx++];
        return { done: false, value: [k, map[k].join(', ')] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype.keys = function() {
    var keys = Object.keys(this._map).sort();
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        return { done: false, value: keys[idx++] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype.values = function() {
    var keys = Object.keys(this._map).sort();
    var map = this._map;
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        return { done: false, value: map[keys[idx++]].join(', ') };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype[Symbol.iterator] = Headers.prototype.entries;

  // --- Response ---
  function Response(body, init) {
    if (init === undefined) init = {};
    this.status = init.status !== undefined ? init.status : 200;
    this.statusText = init.statusText !== undefined ? init.statusText : '';
    this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    this.body = body !== undefined && body !== null ? String(body) : '';
    this.ok = this.status >= 200 && this.status <= 299;
    this.url = '';
    this.redirected = false;
    this.type = 'basic';
    this.bodyUsed = false;
  }

  Response.prototype.text = function() {
    this.bodyUsed = true;
    return Promise.resolve(this.body);
  };

  Response.prototype.json = function() {
    this.bodyUsed = true;
    try {
      return Promise.resolve(JSON.parse(this.body));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  Response.prototype.clone = function() {
    var r = new Response(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers)
    });
    r.url = this.url;
    r.redirected = this.redirected;
    r.type = this.type;
    return r;
  };

  Response.json = function(data, init) {
    if (init === undefined) init = {};
    var headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new Response(JSON.stringify(data), {
      status: init.status !== undefined ? init.status : 200,
      statusText: init.statusText || '',
      headers: headers
    });
  };

  Response.error = function() {
    var r = new Response(null, { status: 0, statusText: '' });
    r.type = 'error';
    r.ok = false;
    return r;
  };

  Response.redirect = function(url, status) {
    if (status === undefined) status = 302;
    var r = new Response(null, {
      status: status,
      statusText: '',
      headers: new Headers({ location: String(url) })
    });
    r.redirected = true;
    return r;
  };

  // --- Request ---
  function Request(input, init) {
    if (init === undefined) init = {};
    if (input instanceof Request) {
      this.url = input.url;
      this.method = input.method;
      this.headers = new Headers(input.headers);
      this.body = input.body;
    } else {
      this.url = String(input);
      this.method = 'GET';
      this.headers = new Headers();
      this.body = null;
    }
    if (init.method !== undefined) this.method = String(init.method).toUpperCase();
    if (init.headers !== undefined) this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    if (init.body !== undefined) this.body = init.body !== null ? String(init.body) : null;
  }

  Request.prototype.clone = function() {
    return new Request(this);
  };

  // --- Assign to globalThis ---
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.URL = URL;
  globalThis.Headers = Headers;
  globalThis.Response = Response;
  globalThis.Request = Request;

  // --- Wrap native fetch ---
  var _nativeFetch = globalThis[Symbol.for('jb:fetch')];
  globalThis.fetch = function fetch(input, init) {
    try {
      var url, method, headers, body;

      if (input instanceof Request) {
        url = input.url;
        method = input.method;
        headers = {};
        input.headers.forEach(function(v, k) { headers[k] = v; });
        body = input.body;
      } else {
        url = String(input);
        method = undefined;
        headers = undefined;
        body = undefined;
      }

      if (init) {
        if (init.method !== undefined) method = String(init.method).toUpperCase();
        if (init.headers !== undefined) {
          var h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
          headers = {};
          h.forEach(function(v, k) { headers[k] = v; });
        }
        if (init.body !== undefined) body = init.body !== null ? String(init.body) : undefined;
      }

      var opts = Object.create(null);
      if (method) opts.method = method;
      if (headers) opts.headers = headers;
      if (body) opts.body = body;

      var raw = _nativeFetch(url, opts);

      var respHeaders = new Headers(raw.headers || {});
      var response = new Response(raw.body, {
        status: raw.status,
        statusText: raw.statusText || '',
        headers: respHeaders
      });
      response.url = raw.url || url;

      return Promise.resolve(response);
    } catch (e) {
      return Promise.reject(new TypeError(e.message || 'fetch failed'));
    }
  };
})();
`,EVENTS_MODULE_SOURCE=`
var EventEmitter = (function() {
  function EE() {
    this._events = {};
    this._maxListeners = 10;
  }
  EE.prototype.on = function(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(listener);
    return this;
  };
  EE.prototype.addListener = EE.prototype.on;
  EE.prototype.once = function(event, listener) {
    var self = this;
    function wrapper() {
      self.removeListener(event, wrapper);
      listener.apply(this, arguments);
    }
    wrapper._original = listener;
    return this.on(event, wrapper);
  };
  EE.prototype.off = function(event, listener) {
    return this.removeListener(event, listener);
  };
  EE.prototype.removeListener = function(event, listener) {
    var list = this._events[event];
    if (list) {
      this._events[event] = list.filter(function(fn) {
        return fn !== listener && fn._original !== listener;
      });
    }
    return this;
  };
  EE.prototype.removeAllListeners = function(event) {
    if (event) delete this._events[event];
    else this._events = {};
    return this;
  };
  EE.prototype.emit = function(event) {
    var list = this._events[event];
    if (!list || list.length === 0) return false;
    var args = Array.prototype.slice.call(arguments, 1);
    var fns = list.slice();
    for (var i = 0; i < fns.length; i++) fns[i].apply(this, args);
    return true;
  };
  EE.prototype.listeners = function(event) {
    return (this._events[event] || []).slice();
  };
  EE.prototype.listenerCount = function(event) {
    return (this._events[event] || []).length;
  };
  EE.prototype.setMaxListeners = function(n) {
    this._maxListeners = n;
    return this;
  };
  EE.prototype.eventNames = function() {
    return Object.keys(this._events);
  };
  EE.prototype.prependListener = function(event, listener) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].unshift(listener);
    return this;
  };
  return EE;
})();
globalThis[Symbol.for('jb:events')] = { EventEmitter: EventEmitter };
`,OS_MODULE_SOURCE=`
var _os = {
  platform: function() { return globalThis.process.platform; },
  arch: function() { return globalThis.process.arch; },
  homedir: function() { return '/home/user'; },
  tmpdir: function() { return '/tmp'; },
  type: function() { return 'Linux'; },
  hostname: function() { return 'sandbox'; },
  EOL: '\\n',
  cpus: function() { return []; },
  totalmem: function() { return 0; },
  freemem: function() { return 0; },
  endianness: function() { return 'LE'; }
};
globalThis[Symbol.for('jb:os')] = _os;
`,URL_MODULE_SOURCE=`
var _urlMod = {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  parse: function(urlStr) {
    try {
      var u = new URL(urlStr);
      return {
        protocol: u.protocol, host: u.host, hostname: u.hostname,
        port: u.port, pathname: u.pathname, search: u.search,
        hash: u.hash, href: u.href, path: u.pathname + u.search
      };
    } catch(e) {
      return {
        protocol: null, host: null, hostname: null, port: null,
        pathname: urlStr, search: '', hash: '', href: urlStr, path: urlStr
      };
    }
  },
  format: function(obj) {
    if (typeof obj === 'string') return obj;
    if (obj instanceof URL) return obj.href;
    var auth = obj.auth ? obj.auth + '@' : '';
    var host = obj.host || ((obj.hostname || '') + (obj.port ? ':' + obj.port : ''));
    return (obj.protocol ? obj.protocol + '//' : '') + auth + host +
      (obj.pathname || '/') + (obj.search || '') + (obj.hash || '');
  }
};
globalThis[Symbol.for('jb:url')] = _urlMod;
`,ASSERT_MODULE_SOURCE=`
var _deepEqual = function(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  var ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    if (!_deepEqual(a[ka[i]], b[ka[i]])) return false;
  }
  return true;
};
var _assert = function(val, msg) {
  if (!val) throw new Error(msg || 'AssertionError: expected truthy value');
};
_assert.ok = _assert;
_assert.equal = function(a, b, msg) {
  if (a != b) throw new Error(msg || 'AssertionError: ' + a + ' != ' + b);
};
_assert.notEqual = function(a, b, msg) {
  if (a == b) throw new Error(msg || 'AssertionError: ' + a + ' == ' + b);
};
_assert.strictEqual = function(a, b, msg) {
  if (a !== b) throw new Error(msg || 'AssertionError: ' + a + ' !== ' + b);
};
_assert.notStrictEqual = function(a, b, msg) {
  if (a === b) throw new Error(msg || 'AssertionError: ' + a + ' === ' + b);
};
_assert.deepEqual = function(a, b, msg) {
  if (!_deepEqual(a, b)) throw new Error(msg || 'AssertionError: objects not deep equal');
};
_assert.deepStrictEqual = _assert.deepEqual;
_assert.notDeepEqual = function(a, b, msg) {
  if (_deepEqual(a, b)) throw new Error(msg || 'AssertionError: objects are deep equal');
};
_assert.throws = function(fn, expected, msg) {
  var threw = false;
  try { fn(); } catch(e) {
    threw = true;
    if (expected instanceof RegExp && !expected.test(e.message))
      throw new Error(msg || 'AssertionError: error message did not match');
  }
  if (!threw) throw new Error(msg || 'AssertionError: function did not throw');
};
_assert.doesNotThrow = function(fn, msg) {
  // @banned-pattern-ignore: sandbox-internal assertion helper; e.message is from user code inside QuickJS, not host details
  try { fn(); } catch(e) {
    throw new Error(msg || 'AssertionError: function threw: ' + e.message);
  }
};
_assert.fail = function(msg) {
  throw new Error(msg || 'AssertionError: assert.fail()');
};
globalThis[Symbol.for('jb:assert')] = _assert;
`,UTIL_MODULE_SOURCE=`
var _util = {
  format: function() {
    var args = Array.prototype.slice.call(arguments);
    if (args.length === 0) return '';
    var fmt = args[0];
    if (typeof fmt !== 'string') {
      return args.map(function(a) {
        return typeof a === 'string' ? a : JSON.stringify(a);
      }).join(' ');
    }
    var i = 1;
    var str = fmt.replace(/%[sdjifoO%]/g, function(m) {
      if (m === '%%') return '%';
      if (i >= args.length) return m;
      var v = args[i++];
      if (m === '%s') return String(v);
      if (m === '%d') return Number(v).toString();
      if (m === '%i') { var n = Number(v); return (isNaN(n) ? 'NaN' : Math.trunc(n)).toString(); }
      if (m === '%j') return JSON.stringify(v);
      if (m === '%f') return parseFloat(v).toString();
      if (m === '%o' || m === '%O') return JSON.stringify(v);
      return m;
    });
    while (i < args.length) {
      str += ' ' + (typeof args[i] === 'string' ? args[i] : JSON.stringify(args[i]));
      i++;
    }
    return str;
  },
  inspect: function(obj, opts) {
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return "'" + obj + "'";
    if (typeof obj === 'function') return '[Function: ' + (obj.name || 'anonymous') + ']';
    var seen = [];
    try {
      return JSON.stringify(obj, function(key, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.indexOf(val) !== -1) return '[Circular]';
          seen.push(val);
        }
        return val;
      });
    } catch(e) { return String(obj); }
  },
  promisify: function(fn) {
    return function() {
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function(resolve, reject) {
        args.push(function(err, val) { if (err) reject(err); else resolve(val); });
        fn.apply(null, args);
      });
    };
  },
  types: {
    isDate: function(v) { return v instanceof Date; },
    isRegExp: function(v) { return v instanceof RegExp; },
    isArray: function(v) { return Array.isArray(v); },
    isMap: function(v) { return typeof Map !== 'undefined' && v instanceof Map; },
    isSet: function(v) { return typeof Set !== 'undefined' && v instanceof Set; }
  },
  inherits: function(ctor, superCtor) {
    ctor.prototype = Object.create(superCtor.prototype);
    ctor.prototype.constructor = ctor;
  }
};
globalThis[Symbol.for('jb:util')] = _util;
`,BUFFER_MODULE_SOURCE=`
function _utf8Encode(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
      var lo = str.charCodeAt(++i);
      var cp = ((c - 0xD800) * 0x400) + (lo - 0xDC00) + 0x10000;
      bytes.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3F), 0x80 | ((cp >> 6) & 0x3F), 0x80 | (cp & 0x3F));
    } else {
      bytes.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return bytes;
}
function _utf8Decode(bytes) {
  var str = '';
  var i = 0;
  while (i < bytes.length) {
    var b = bytes[i];
    if (b < 0x80) { str += String.fromCharCode(b); i++; }
    else if ((b & 0xE0) === 0xC0) { str += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i+1] & 0x3F)); i += 2; }
    else if ((b & 0xF0) === 0xE0) { str += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i+1] & 0x3F) << 6) | (bytes[i+2] & 0x3F)); i += 3; }
    else if ((b & 0xF8) === 0xF0) { var cp = ((b & 0x07) << 18) | ((bytes[i+1] & 0x3F) << 12) | ((bytes[i+2] & 0x3F) << 6) | (bytes[i+3] & 0x3F); cp -= 0x10000; str += String.fromCharCode((cp >> 10) + 0xD800, (cp & 0x3FF) + 0xDC00); i += 4; }
    else { i++; }
  }
  return str;
}
// _utf8Encode/_utf8Decode are IIFE-local vars, available to all module shims
// IMPORTANT: round-trip tests (encode then decode) mask broken encodings
// because both sides become no-ops. Encoding tests MUST assert the encoded
// constant directly.
function _normEnc(enc) {
  if (enc === undefined || enc === null) return 'utf8';
  var e = String(enc).toLowerCase();
  if (e === 'utf8' || e === 'utf-8') return 'utf8';
  if (e === 'utf16le' || e === 'utf-16le' || e === 'ucs2' || e === 'ucs-2') return 'utf16le';
  if (e === 'latin1' || e === 'binary') return 'latin1';
  if (e === 'ascii') return 'ascii';
  if (e === 'base64') return 'base64';
  if (e === 'base64url') return 'base64url';
  if (e === 'hex') return 'hex';
  return undefined;
}
function _badEnc(enc) {
  throw new TypeError("Unknown encoding: " + enc);
}
var _HEX = '0123456789abcdef';
function _hexEncode(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    s += _HEX.charAt(b >> 4) + _HEX.charAt(b & 0x0f);
  }
  return s;
}
function _hexDecode(str) {
  var out = [];
  for (var i = 0; i + 1 < str.length; i += 2) {
    var hi = _hexVal(str.charCodeAt(i));
    var lo = _hexVal(str.charCodeAt(i + 1));
    if (hi < 0 || lo < 0) break;
    out.push((hi << 4) | lo);
  }
  return out;
}
function _hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}
function _rawEncode(str) {
  var out = new Array(str.length);
  for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}
function _latin1Decode(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff);
  return s;
}
function _asciiDecode(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0x7f);
  return s;
}
function _utf16leEncode(str) {
  var out = new Array(str.length * 2);
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = (c >> 8) & 0xff;
  }
  return out;
}
function _utf16leDecode(bytes) {
  var s = '';
  var end = bytes.length & ~1;
  for (var i = 0; i < end; i += 2) {
    s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  }
  return s;
}
var _B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
var _B64DEC = null;
function _b64DecTable() {
  if (_B64DEC) return _B64DEC;
  var t = new Array(256);
  for (var i = 0; i < 256; i++) t[i] = -1;
  for (var j = 0; j < 64; j++) t[_B64.charCodeAt(j)] = j;
  t[45] = 62;
  t[95] = 63;
  _B64DEC = t;
  return t;
}
function _b64Encode(bytes) {
  var s = '';
  var i = 0, len = bytes.length;
  while (i + 2 < len) {
    var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    s += _B64.charAt((n >> 18) & 63) + _B64.charAt((n >> 12) & 63)
       + _B64.charAt((n >> 6) & 63)  + _B64.charAt(n & 63);
    i += 3;
  }
  var rem = len - i;
  if (rem === 1) {
    var n1 = bytes[i] << 16;
    s += _B64.charAt((n1 >> 18) & 63) + _B64.charAt((n1 >> 12) & 63) + '==';
  } else if (rem === 2) {
    var n2 = (bytes[i] << 16) | (bytes[i + 1] << 8);
    s += _B64.charAt((n2 >> 18) & 63) + _B64.charAt((n2 >> 12) & 63)
       + _B64.charAt((n2 >> 6) & 63) + '=';
  }
  return s;
}
function _b64UrlEncode(bytes) {
  var s = _b64Encode(bytes);
  return s.replace(/=+$/, '').replace(/\\+/g, '-').replace(/\\//g, '_');
}
function _b64Decode(str) {
  var t = _b64DecTable();
  var out = [];
  var buf = 0, bits = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c === 61) break;
    var v = c < 256 ? t[c] : -1;
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return out;
}

function Buffer(arg) {
  if (typeof arg === 'number') {
    this._data = new Uint8Array(arg);
  } else if (arg instanceof ArrayBuffer) {
    this._data = new Uint8Array(arg);
  } else if (arg instanceof Uint8Array) {
    this._data = new Uint8Array(arg);
  } else if (Array.isArray(arg)) {
    this._data = new Uint8Array(arg);
  } else {
    this._data = new Uint8Array(0);
  }
  this.length = this._data.length;
}
Buffer.from = function(data, encoding) {
  if (typeof data === 'string') {
    var enc = _normEnc(encoding);
    if (enc === undefined) _badEnc(encoding);
    if (enc === 'utf8')      return new Buffer(_utf8Encode(data));
    if (enc === 'utf16le')   return new Buffer(_utf16leEncode(data));
    if (enc === 'latin1')    return new Buffer(_rawEncode(data));
    if (enc === 'ascii')     return new Buffer(_rawEncode(data));
    if (enc === 'hex')       return new Buffer(_hexDecode(data));
    if (enc === 'base64' || enc === 'base64url') return new Buffer(_b64Decode(data));
  }
  if (data instanceof ArrayBuffer) {
    var off = typeof encoding === 'number' ? encoding : 0;
    var len = arguments.length > 2 ? arguments[2] : undefined;
    var view = len === undefined ? new Uint8Array(data, off) : new Uint8Array(data, off, len);
    var buf = Object.create(Buffer.prototype);
    buf._data = view;
    buf.length = view.length;
    return buf;
  }
  if (data instanceof Uint8Array)  return new Buffer(data);
  if (Array.isArray(data))         return new Buffer(data);
  if (data && data._data)          return new Buffer(data._data.slice());
  return new Buffer(0);
};
Buffer.alloc = function(size, fill) {
  var buf = new Buffer(size);
  if (fill !== undefined) {
    var fillByte = typeof fill === 'number' ? fill : 0;
    buf._data.fill(fillByte);
  }
  return buf;
};
Buffer.allocUnsafe = Buffer.alloc;
Buffer.isBuffer = function(obj) { return obj instanceof Buffer; };
Buffer.concat = function(list, totalLength) {
  if (!totalLength) {
    totalLength = 0;
    for (var i = 0; i < list.length; i++) totalLength += list[i].length;
  }
  var result = new Uint8Array(totalLength);
  var offset = 0;
  for (var i = 0; i < list.length; i++) {
    result.set(list[i]._data, offset);
    offset += list[i].length;
  }
  return new Buffer(result);
};
Buffer.byteLength = function(value, encoding) {
  if (typeof value !== 'string') {
    if (value && value._data) return value._data.length;
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return value.byteLength;
    }
    throw new TypeError('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received type ' + typeof value + ' (' + value + ')');
  }
  var enc = _normEnc(encoding);
  if (enc === undefined) _badEnc(encoding);
  if (enc === 'utf8')      return _utf8Encode(value).length;
  if (enc === 'utf16le')   return value.length * 2;
  if (enc === 'latin1' || enc === 'ascii') return value.length;
  if (enc === 'hex')       return (value.length / 2) | 0;
  if (enc === 'base64' || enc === 'base64url') {
    var clean = value.replace(/[^A-Za-z0-9+/=_-]/g, '').replace(/=+$/, '');
    return Math.floor(clean.length * 3 / 4);
  }
};
Buffer.prototype.toString = function(encoding, start, end) {
  var bytes = this._data;
  if (start !== undefined || end !== undefined) {
    var len = bytes.length;
    var s = start === undefined ? 0 : (start < 0 ? 0 : (start > len ? len : start | 0));
    var e = end === undefined ? len : (end < 0 ? 0 : (end > len ? len : end | 0));
    bytes = e <= s ? bytes.subarray(0, 0) : bytes.subarray(s, e);
  }
  var enc = _normEnc(encoding);
  if (enc === undefined) _badEnc(encoding);
  if (enc === 'utf8')      return _utf8Decode(bytes);
  if (enc === 'utf16le')   return _utf16leDecode(bytes);
  if (enc === 'latin1')    return _latin1Decode(bytes);
  if (enc === 'ascii')     return _asciiDecode(bytes);
  if (enc === 'hex')       return _hexEncode(bytes);
  if (enc === 'base64')    return _b64Encode(bytes);
  if (enc === 'base64url') return _b64UrlEncode(bytes);
};
Buffer.prototype.toJSON = function() {
  return { type: 'Buffer', data: Array.from(this._data) };
};
Buffer.prototype.slice = function(start, end) {
  return new Buffer(this._data.slice(start, end));
};
Buffer.prototype.copy = function(target, targetStart, sourceStart, sourceEnd) {
  targetStart = targetStart || 0;
  sourceStart = sourceStart || 0;
  sourceEnd = sourceEnd || this.length;
  var sub = this._data.subarray(sourceStart, sourceEnd);
  target._data.set(sub, targetStart);
  return sub.length;
};
Buffer.prototype.write = function(str, offset, length, encoding) {
  if (typeof offset === 'string') { encoding = offset; offset = 0; length = undefined; }
  else if (typeof length === 'string') { encoding = length; length = undefined; }
  offset = offset | 0;
  if (offset < 0 || offset > this._data.length) {
    throw new RangeError('The value of "offset" is out of range. It must be >= 0 && <= ' + this._data.length + '. Received ' + offset);
  }
  var enc = _normEnc(encoding);
  if (enc === undefined) _badEnc(encoding);
  var bytes;
  if (enc === 'utf8')         bytes = _utf8Encode(str);
  else if (enc === 'utf16le') bytes = _utf16leEncode(str);
  else if (enc === 'latin1')  bytes = _rawEncode(str);
  else if (enc === 'ascii')   bytes = _rawEncode(str);
  else if (enc === 'hex')     bytes = _hexDecode(str);
  else                        bytes = _b64Decode(str);
  var max = this._data.length - offset;
  if (length !== undefined) {
    length = length | 0;
    if (length < 0 || length > this._data.length) {
      throw new RangeError('The value of "length" is out of range. It must be >= 0 && <= ' + this._data.length + '. Received ' + length);
    }
  }
  var write = Math.min(length === undefined ? max : length, bytes.length, max);
  for (var i = 0; i < write; i++) this._data[offset + i] = bytes[i];
  return write;
};
Buffer.prototype.fill = function(val, offset, end) {
  this._data.fill(typeof val === 'number' ? val : 0, offset, end);
  return this;
};
Buffer.prototype.equals = function(other) {
  if (this.length !== other.length) return false;
  for (var i = 0; i < this.length; i++) {
    if (this._data[i] !== other._data[i]) return false;
  }
  return true;
};
Buffer.prototype.readUInt8 = function(offset) { return this._data[offset]; };
Buffer.prototype.writeUInt8 = function(value, offset) { this._data[offset] = value; return offset + 1; };
globalThis[Symbol.for('jb:buffer')] = { Buffer: Buffer };
globalThis.Buffer = Buffer;
`,STREAM_MODULE_SOURCE=`
var _EE = globalThis[Symbol.for('jb:events')].EventEmitter;

function Stream() { _EE.call(this); }
Stream.prototype = Object.create(_EE.prototype);
Stream.prototype.constructor = Stream;
Stream.prototype.pipe = function(dest) {
  this.on('data', function(chunk) { dest.write(chunk); });
  this.on('end', function() { if (dest.end) dest.end(); });
  return dest;
};

function Readable(opts) {
  Stream.call(this);
  this.readable = true;
  this._readableState = { ended: false, buffer: [] };
}
Readable.prototype = Object.create(Stream.prototype);
Readable.prototype.constructor = Readable;
Readable.prototype.read = function() { return null; };
Readable.prototype.push = function(chunk) {
  if (chunk === null) { this._readableState.ended = true; this.emit('end'); return false; }
  this.emit('data', chunk);
  return true;
};
Readable.prototype.destroy = function() { this.emit('close'); return this; };

function Writable(opts) {
  Stream.call(this);
  this.writable = true;
  this._writableState = { ended: false };
}
Writable.prototype = Object.create(Stream.prototype);
Writable.prototype.constructor = Writable;
Writable.prototype.write = function(chunk) { return true; };
Writable.prototype.end = function(chunk) {
  if (chunk) this.write(chunk);
  this._writableState.ended = true;
  this.emit('finish');
  return this;
};
Writable.prototype.destroy = function() { this.emit('close'); return this; };

function Duplex(opts) {
  Readable.call(this, opts);
  Writable.call(this, opts);
}
Duplex.prototype = Object.create(Readable.prototype);
var _wKeys = Object.keys(Writable.prototype);
for (var _wi = 0; _wi < _wKeys.length; _wi++) {
  if (!Duplex.prototype[_wKeys[_wi]]) Duplex.prototype[_wKeys[_wi]] = Writable.prototype[_wKeys[_wi]];
}
Duplex.prototype.constructor = Duplex;

function Transform(opts) { Duplex.call(this, opts); }
Transform.prototype = Object.create(Duplex.prototype);
Transform.prototype.constructor = Transform;
Transform.prototype._transform = function(chunk, encoding, cb) { if (cb) cb(null, chunk); };

function PassThrough(opts) { Transform.call(this, opts); }
PassThrough.prototype = Object.create(Transform.prototype);
PassThrough.prototype.constructor = PassThrough;

function pipeline() {
  var streams = Array.prototype.slice.call(arguments);
  var cb = typeof streams[streams.length - 1] === 'function' ? streams.pop() : null;
  for (var i = 0; i < streams.length - 1; i++) streams[i].pipe(streams[i + 1]);
  if (cb) {
    var last = streams[streams.length - 1];
    last.on('finish', function() { cb(null); });
    last.on('error', function(e) { cb(e); });
  }
  return streams[streams.length - 1];
}

globalThis[Symbol.for('jb:stream')] = {
  Stream: Stream, Readable: Readable, Writable: Writable,
  Duplex: Duplex, Transform: Transform, PassThrough: PassThrough,
  pipeline: pipeline
};
`,STRING_DECODER_MODULE_SOURCE=`
function StringDecoder(encoding) {
  this.encoding = (encoding || 'utf-8').toLowerCase();
  if (this.encoding === 'utf8') this.encoding = 'utf-8';
}
StringDecoder.prototype.write = function(buf) {
  if (typeof buf === 'string') return buf;
  var data = buf instanceof Uint8Array ? buf : (buf && buf._data ? buf._data : new Uint8Array(0));
  return _utf8Decode(data);
};
StringDecoder.prototype.end = function(buf) {
  if (buf) return this.write(buf);
  return '';
};
globalThis[Symbol.for('jb:string_decoder')] = { StringDecoder: StringDecoder };
`,QUERYSTRING_MODULE_SOURCE=`
var _qs = {
  parse: function(str, sep, eq) {
    sep = sep || '&'; eq = eq || '=';
    var result = Object.create(null);
    if (!str || typeof str !== 'string') return result;
    var pairs = str.split(sep);
    for (var i = 0; i < pairs.length; i++) {
      var idx = pairs[i].indexOf(eq);
      var key, val;
      if (idx >= 0) {
        key = decodeURIComponent(pairs[i].slice(0, idx).replace(/\\+/g, ' '));
        val = decodeURIComponent(pairs[i].slice(idx + 1).replace(/\\+/g, ' '));
      } else {
        key = decodeURIComponent(pairs[i].replace(/\\+/g, ' '));
        val = '';
      }
      if (result[key] !== undefined) {
        if (Array.isArray(result[key])) result[key].push(val);
        else result[key] = [result[key], val];
      } else {
        result[key] = val;
      }
    }
    return result;
  },
  stringify: function(obj, sep, eq) {
    sep = sep || '&'; eq = eq || '=';
    var pairs = [];
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var val = obj[key];
      if (Array.isArray(val)) {
        for (var j = 0; j < val.length; j++) {
          pairs.push(encodeURIComponent(key) + eq + encodeURIComponent(val[j]));
        }
      } else {
        pairs.push(encodeURIComponent(key) + eq + encodeURIComponent(val));
      }
    }
    return pairs.join(sep);
  },
  escape: function(str) { return encodeURIComponent(str); },
  unescape: function(str) { return decodeURIComponent(str); }
};
_qs.decode = _qs.parse;
_qs.encode = _qs.stringify;
globalThis[Symbol.for('jb:querystring')] = _qs;
`,UNSUPPORTED_MODULES=Object.assign(Object.create(null),{http:"Use fetch() for HTTP requests.",https:"Use fetch() for HTTP requests.",http2:"Use fetch() for HTTP requests.",net:"Network socket APIs are not supported.",tls:"Network socket APIs are not supported.",dgram:"Network socket APIs are not supported.",dns:"DNS APIs are not supported.",cluster:"Cluster APIs are not supported.",worker_threads:"Worker thread APIs are not supported.",vm:"VM APIs are not supported.",v8:"V8 APIs are not supported.",inspector:"Inspector APIs are not supported.",readline:"Readline APIs are not supported.",repl:"REPL APIs are not supported.",module:"Module APIs are not supported.",perf_hooks:"Performance hooks are not supported.",async_hooks:"Async hooks are not supported.",diagnostics_channel:"Diagnostics channel is not supported.",trace_events:"Trace events are not supported.",crypto:"Crypto APIs are not available in this sandbox.",zlib:"Compression APIs are not supported.",tty:"TTY APIs are not supported.",domain:"Domain APIs are not supported."}),PATH_MODULE_SOURCE=`
(function() {
  var sep = '/';
  var delimiter = ':';

  function normalize(p) {
    if (p === '') return '.';
    var isAbs = p.charCodeAt(0) === 47;
    var trailingSlash = p.charCodeAt(p.length - 1) === 47;
    var parts = p.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
        else if (!isAbs) out.push('..');
      } else {
        out.push(seg);
      }
    }
    var result = out.join('/');
    if (isAbs) result = '/' + result;
    if (trailingSlash && result[result.length - 1] !== '/') result += '/';
    return result || (isAbs ? '/' : '.');
  }

  function join() {
    var joined = '';
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      if (typeof arg !== 'string') throw new TypeError('Path must be a string');
      if (arg.length > 0) {
        if (joined.length > 0) joined += '/' + arg;
        else joined = arg;
      }
    }
    if (joined.length === 0) return '.';
    return normalize(joined);
  }

  function resolve() {
    var resolved = '';
    var resolvedAbsolute = false;
    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path = i >= 0 ? arguments[i] : globalThis.process.cwd();
      if (typeof path !== 'string') throw new TypeError('Path must be a string');
      if (path.length === 0) continue;
      if (resolved.length > 0) resolved = path + '/' + resolved;
      else resolved = path;
      resolvedAbsolute = path.charCodeAt(0) === 47;
    }
    resolved = normalize(resolved);
    if (resolvedAbsolute) return '/' + resolved.replace(/^\\/+/, '');
    return resolved.length > 0 ? resolved : '.';
  }

  function isAbsolute(p) {
    return typeof p === 'string' && p.length > 0 && p.charCodeAt(0) === 47;
  }

  function dirname(p) {
    if (p.length === 0) return '.';
    var hasRoot = p.charCodeAt(0) === 47;
    var end = -1;
    for (var i = p.length - 1; i >= 1; i--) {
      if (p.charCodeAt(i) === 47) { end = i; break; }
    }
    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 0) return '/';
    return p.slice(0, end);
  }

  function basename(p, ext) {
    var start = 0;
    for (var i = p.length - 1; i >= 0; i--) {
      if (p.charCodeAt(i) === 47) { start = i + 1; break; }
    }
    var base = p.slice(start);
    if (ext && base.endsWith(ext)) {
      base = base.slice(0, base.length - ext.length);
    }
    return base;
  }

  function extname(p) {
    var startDot = -1;
    var startPart = 0;
    for (var i = p.length - 1; i >= 0; i--) {
      var code = p.charCodeAt(i);
      if (code === 47) { startPart = i + 1; break; }
      if (code === 46 && startDot === -1) startDot = i;
    }
    if (startDot === -1 || startDot === startPart ||
        (startDot === startPart + 1 && p.charCodeAt(startPart) === 46)) {
      return '';
    }
    return p.slice(startDot);
  }

  function relative(from, to) {
    if (from === to) return '';
    from = resolve(from);
    to = resolve(to);
    if (from === to) return '';
    var fromParts = from.split('/').filter(Boolean);
    var toParts = to.split('/').filter(Boolean);
    var common = 0;
    var length = Math.min(fromParts.length, toParts.length);
    for (var i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) break;
      common++;
    }
    var ups = [];
    for (var i = common; i < fromParts.length; i++) ups.push('..');
    return ups.concat(toParts.slice(common)).join('/') || '.';
  }

  function parse(p) {
    var root = p.charCodeAt(0) === 47 ? '/' : '';
    var dir = dirname(p);
    var base = basename(p);
    var ext = extname(p);
    var name = ext ? base.slice(0, base.length - ext.length) : base;
    return { root: root, dir: dir, base: base, ext: ext, name: name };
  }

  function format(obj) {
    var dir = obj.dir || obj.root || '';
    var base = obj.base || ((obj.name || '') + (obj.ext || ''));
    if (!dir) return base;
    if (dir === obj.root) return dir + base;
    return dir + '/' + base;
  }

  var posix = { sep: sep, delimiter: delimiter, join: join, resolve: resolve, normalize: normalize, isAbsolute: isAbsolute, dirname: dirname, basename: basename, extname: extname, relative: relative, parse: parse, format: format };
  posix.posix = posix;

  globalThis[Symbol.for('jb:path')] = posix;
})();
`,quickjsModule=null,quickjsLoading=null;async function getQuickJSModule(){return quickjsModule||quickjsLoading||(quickjsLoading=o(),quickjsModule=await quickjsLoading)}var MEMORY_LIMIT=0x4000000,INTERRUPT_CYCLES=1e5,PROCESS_EXIT_MARKER="__just_bash_process_exit_marker__";function formatError(e){if("object"==typeof e&&null!==e&&"message"in e){let t=e.message;if(e.stack)for(let r of e.stack.split("\n")){let e=r.trim();if(e.startsWith("at ")){let r=e.replace(/^at <eval> \((\/.+)\)$/,"at $1");return`${r}: ${t}`}}return t}return String(e)}function throwError(e,t){return{error:e.newError(t)}}function isProcessExit(e,t,r){let o=e.getProp(t,PROCESS_EXIT_MARKER),s=e.sameValue(o,r);return o.dispose(),s}function jsToHandle(e,t){if(null==t)return e.undefined;if("string"==typeof t)return e.newString(t);if("number"==typeof t)return e.newNumber(t);if("boolean"==typeof t)return t?e.true:e.false;if(Array.isArray(t)){let r=e.newArray();for(let o=0;o<t.length;o++){let s=jsToHandle(e,t[o]);e.setProp(r,o,s),s.dispose()}return r}if("object"==typeof t){let r=e.newObject();for(let[o,s]of Object.entries(t)){let t=jsToHandle(e,s);e.setProp(r,o,t),t.dispose()}return r}return e.undefined}function resolveModulePath(e,t,r){if(e.startsWith("/"))return e;let o=t?t.substring(0,t.lastIndexOf("/"))||"/":r,s=`${o}/${e}`.split("/").filter(Boolean),n=[];for(let e of s)".."===e?n.pop():"."!==e&&n.push(e);return`/${n.join("/")}`}var VIRTUAL_MODULES=Object.assign(Object.create(null),{fs:`
    const _fs = globalThis.fs;
    export const readFile = _fs.readFile;
    export const readFileSync = function(path, opts) { return _fs.readFileSync(path, opts); };
    export const readFileBuffer = _fs.readFileBuffer;
    export const writeFile = _fs.writeFile;
    export const writeFileSync = _fs.writeFileSync;
    export const stat = _fs.stat;
    export const statSync = _fs.statSync;
    export const lstat = _fs.lstat;
    export const lstatSync = _fs.lstatSync;
    export const readdir = _fs.readdir;
    export const readdirSync = _fs.readdirSync;
    export const mkdir = _fs.mkdir;
    export const mkdirSync = _fs.mkdirSync;
    export const rm = _fs.rm;
    export const rmSync = _fs.rmSync;
    export const exists = _fs.exists;
    export const existsSync = _fs.existsSync;
    export const appendFile = _fs.appendFile;
    export const appendFileSync = _fs.appendFileSync;
    export const symlink = _fs.symlink;
    export const symlinkSync = _fs.symlinkSync;
    export const readlink = _fs.readlink;
    export const readlinkSync = _fs.readlinkSync;
    export const chmod = _fs.chmod;
    export const chmodSync = _fs.chmodSync;
    export const realpath = _fs.realpath;
    export const realpathSync = _fs.realpathSync;
    export const rename = _fs.rename;
    export const renameSync = _fs.renameSync;
    export const copyFile = _fs.copyFile;
    export const copyFileSync = _fs.copyFileSync;
    export const unlinkSync = _fs.unlinkSync;
    export const unlink = _fs.unlink;
    export const rmdirSync = _fs.rmdirSync;
    export const rmdir = _fs.rmdir;
    export const promises = _fs.promises;
    export default _fs;
  `,path:`${PATH_MODULE_SOURCE}
    const _path = globalThis[Symbol.for('jb:path')];
    export const join = _path.join;
    export const resolve = _path.resolve;
    export const normalize = _path.normalize;
    export const isAbsolute = _path.isAbsolute;
    export const dirname = _path.dirname;
    export const basename = _path.basename;
    export const extname = _path.extname;
    export const relative = _path.relative;
    export const parse = _path.parse;
    export const format = _path.format;
    export const sep = _path.sep;
    export const delimiter = _path.delimiter;
    export const posix = _path.posix;
    export default _path;
  `,process:`
    const _process = globalThis.process;
    export const argv = _process.argv;
    export const cwd = _process.cwd;
    export const exit = _process.exit;
    export const env = _process.env;
    export const platform = _process.platform;
    export const arch = _process.arch;
    export const versions = _process.versions;
    export const version = _process.version;
    export default _process;
  `,child_process:`
    const _exec = globalThis[Symbol.for('jb:exec')];
    const _execArgs = globalThis[Symbol.for('jb:execArgs')];
    export function execSync(cmd, opts) {
      var r = _exec(cmd, opts);
      if (r.exitCode !== 0) {
        var e = new Error('Command failed: ' + cmd);
        e.status = r.exitCode;
        e.stderr = r.stderr;
        e.stdout = r.stdout;
        throw e;
      }
      return r.stdout;
    }
    export function exec(cmd, opts) { return _exec(cmd, opts); }
    export function spawnSync(cmd, args, opts) {
      var r = _execArgs(cmd, args || []);
      return { stdout: r.stdout, stderr: r.stderr, status: r.exitCode };
    }
    export default { exec: exec, execSync: execSync, spawnSync: spawnSync };
  `,os:`
    const _os = globalThis[Symbol.for('jb:os')];
    export const platform = _os.platform;
    export const arch = _os.arch;
    export const homedir = _os.homedir;
    export const tmpdir = _os.tmpdir;
    export const type = _os.type;
    export const hostname = _os.hostname;
    export const EOL = _os.EOL;
    export const cpus = _os.cpus;
    export const totalmem = _os.totalmem;
    export const freemem = _os.freemem;
    export const endianness = _os.endianness;
    export default _os;
  `,url:`
    const _url = globalThis[Symbol.for('jb:url')];
    export const URL = _url.URL;
    export const URLSearchParams = _url.URLSearchParams;
    export const parse = _url.parse;
    export const format = _url.format;
    export default _url;
  `,assert:`
    const _assert = globalThis[Symbol.for('jb:assert')];
    export const ok = _assert.ok;
    export const equal = _assert.equal;
    export const notEqual = _assert.notEqual;
    export const strictEqual = _assert.strictEqual;
    export const notStrictEqual = _assert.notStrictEqual;
    export const deepEqual = _assert.deepEqual;
    export const deepStrictEqual = _assert.deepStrictEqual;
    export const notDeepEqual = _assert.notDeepEqual;
    export const throws = _assert.throws;
    export const doesNotThrow = _assert.doesNotThrow;
    export const fail = _assert.fail;
    export default _assert;
  `,util:`
    const _util = globalThis[Symbol.for('jb:util')];
    export const format = _util.format;
    export const inspect = _util.inspect;
    export const promisify = _util.promisify;
    export const types = _util.types;
    export const inherits = _util.inherits;
    export default _util;
  `,events:`
    const _events = globalThis[Symbol.for('jb:events')];
    export const EventEmitter = _events.EventEmitter;
    export default _events;
  `,buffer:`
    const _buffer = globalThis[Symbol.for('jb:buffer')];
    export const Buffer = _buffer.Buffer;
    export default _buffer;
  `,stream:`
    const _stream = globalThis[Symbol.for('jb:stream')];
    export const Stream = _stream.Stream;
    export const Readable = _stream.Readable;
    export const Writable = _stream.Writable;
    export const Duplex = _stream.Duplex;
    export const Transform = _stream.Transform;
    export const PassThrough = _stream.PassThrough;
    export const pipeline = _stream.pipeline;
    export default _stream;
  `,string_decoder:`
    const _sd = globalThis[Symbol.for('jb:string_decoder')];
    export const StringDecoder = _sd.StringDecoder;
    export default _sd;
  `,querystring:`
    const _qs = globalThis[Symbol.for('jb:querystring')];
    export const parse = _qs.parse;
    export const stringify = _qs.stringify;
    export const escape = _qs.escape;
    export const unescape = _qs.unescape;
    export const decode = _qs.decode;
    export const encode = _qs.encode;
    export default _qs;
  `});for(let[name,hint]of Object.entries(UNSUPPORTED_MODULES))VIRTUAL_MODULES[name]=`throw new Error("Module '${name}' is not available in the js-exec sandbox. ${hint} Run 'js-exec --help' for available modules.");`;function setupContext(e,t,r,o){let s=e.newObject(),n=e.newFunction("log",(...r)=>{let o=r.map(t=>{let r=e.dump(t);return"string"==typeof r?r:JSON.stringify(r)});try{t.writeStdout(`${o.join(" ")}
`)}catch(t){return throwError(e,t.message||"write failed")}return e.undefined});e.setProp(s,"log",n),n.dispose();let i=e.newFunction("error",(...r)=>{let o=r.map(t=>{let r=e.dump(t);return"string"==typeof r?r:JSON.stringify(r)});try{t.writeStderr(`${o.join(" ")}
`)}catch(t){return throwError(e,t.message||"write failed")}return e.undefined});e.setProp(s,"error",i),i.dispose();let a=e.newFunction("warn",(...r)=>{let o=r.map(t=>{let r=e.dump(t);return"string"==typeof r?r:JSON.stringify(r)});try{t.writeStderr(`${o.join(" ")}
`)}catch(t){return throwError(e,t.message||"write failed")}return e.undefined});e.setProp(s,"warn",a),a.dispose(),e.setProp(e.global,"console",s),s.dispose();let c=e.newObject(),l=e.newFunction("readFile",r=>{let o=e.getString(r);try{let r=t.readFile(o);return e.newString(new TextDecoder().decode(r))}catch(t){return throwError(e,t.message||"readFile failed")}});e.setProp(c,"readFile",l),l.dispose();let p=e.newFunction("readFileBuffer",r=>{let o=e.getString(r);try{let r=t.readFile(o);return e.newArrayBuffer(r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength))}catch(t){return throwError(e,t.message||"readFileBuffer failed")}});e.setProp(c,"readFileBuffer",p),p.dispose();let u=e.newFunction("writeFile",(r,o)=>{let s=e.getString(r),n=e.getString(o);try{return t.writeFile(s,new TextEncoder().encode(n)),e.undefined}catch(t){return throwError(e,t.message||"writeFile failed")}});e.setProp(c,"writeFile",u),u.dispose();let f=e.newFunction("stat",r=>{let o=e.getString(r);try{let r=t.stat(o);return jsToHandle(e,{isFile:r.isFile,isDirectory:r.isDirectory,isSymbolicLink:r.isSymbolicLink,mode:r.mode,size:r.size,mtime:r.mtime.toISOString()})}catch(t){return throwError(e,t.message||"stat failed")}});e.setProp(c,"stat",f),f.dispose();let d=e.newFunction("readdir",r=>{let o=e.getString(r);try{let r=t.readdir(o);return jsToHandle(e,r)}catch(t){return throwError(e,t.message||"readdir failed")}});e.setProp(c,"readdir",d),d.dispose();let h=e.newFunction("mkdir",(r,o)=>{let s=e.getString(r),n=!1;if(o){let t=e.dump(o);t&&"object"==typeof t&&"recursive"in t&&(n=!!t.recursive)}try{return t.mkdir(s,n),e.undefined}catch(t){return throwError(e,t.message||"mkdir failed")}});e.setProp(c,"mkdir",h),h.dispose();let y=e.newFunction("rm",(r,o)=>{let s=e.getString(r),n=!1,i=!1;if(o){let t=e.dump(o);t&&"object"==typeof t&&("recursive"in t&&(n=!!t.recursive),"force"in t&&(i=!!t.force))}try{return t.rm(s,n,i),e.undefined}catch(t){return throwError(e,t.message||"rm failed")}});e.setProp(c,"rm",y),y.dispose();let g=e.newFunction("exists",r=>{let o=e.getString(r);return t.exists(o)?e.true:e.false});e.setProp(c,"exists",g),g.dispose();let m=e.newFunction("appendFile",(r,o)=>{let s=e.getString(r),n=e.getString(o);try{return t.appendFile(s,new TextEncoder().encode(n)),e.undefined}catch(t){return throwError(e,t.message||"appendFile failed")}});e.setProp(c,"appendFile",m),m.dispose();let b=e.newFunction("lstat",r=>{let o=e.getString(r);try{let r=t.lstat(o);return jsToHandle(e,{isFile:r.isFile,isDirectory:r.isDirectory,isSymbolicLink:r.isSymbolicLink,mode:r.mode,size:r.size,mtime:r.mtime.toISOString()})}catch(t){return throwError(e,t.message||"lstat failed")}});e.setProp(c,"lstat",b),b.dispose();let _=e.newFunction("symlink",(r,o)=>{let s=e.getString(r),n=e.getString(o);try{return t.symlink(s,n),e.undefined}catch(t){return throwError(e,t.message||"symlink failed")}});e.setProp(c,"symlink",_),_.dispose();let v=e.newFunction("readlink",r=>{let o=e.getString(r);try{let r=t.readlink(o);return e.newString(r)}catch(t){return throwError(e,t.message||"readlink failed")}});e.setProp(c,"readlink",v),v.dispose();let w=e.newFunction("chmod",(r,o)=>{let s=e.getString(r),n=e.dump(o);try{return t.chmod(s,"number"==typeof n?n:0),e.undefined}catch(t){return throwError(e,t.message||"chmod failed")}});e.setProp(c,"chmod",w),w.dispose();let S=e.newFunction("realpath",r=>{let o=e.getString(r);try{let r=t.realpath(o);return e.newString(r)}catch(t){return throwError(e,t.message||"realpath failed")}});e.setProp(c,"realpath",S),S.dispose();let E=e.newFunction("rename",(r,o)=>{let s=e.getString(r),n=e.getString(o);try{return t.rename(s,n),e.undefined}catch(t){return throwError(e,t.message||"rename failed")}});e.setProp(c,"rename",E),E.dispose();let x=e.newFunction("copyFile",(r,o)=>{let s=e.getString(r),n=e.getString(o);try{return t.copyFile(s,n),e.undefined}catch(t){return throwError(e,t.message||"copyFile failed")}});e.setProp(c,"copyFile",x),x.dispose(),e.setProp(e.global,"fs",c),c.dispose();let T=e.newFunction("fetch",(r,o)=>{let s,n=e.getString(r);o&&(s=e.dump(o));try{let r=t.httpRequest(n,{method:s?.method,headers:s?.headers,body:s?.body});return jsToHandle(e,r)}catch(t){return throwError(e,t.message||"fetch failed")}});e.setProp(e.global,"__fetch",T),T.dispose();let O=e.newFunction("exec",(r,o)=>{let s,n=e.getString(r);if(o){let t=e.dump(o);t?.stdin&&(s=String(t.stdin))}try{let r=t.execCommand(n,s);return jsToHandle(e,r)}catch(t){return throwError(e,t.message||"exec failed")}});e.setProp(e.global,"__exec",O),O.dispose();let P=e.newFunction("execArgs",(r,o)=>{let s=e.getString(r),n=e.dump(o);try{let r=t.execCommandArgs(s,n);return jsToHandle(e,r)}catch(t){return throwError(e,t.message||"exec failed")}});if(e.setProp(e.global,"__execArgs",P),P.dispose(),r.hasInvokeTool){let r=e.newFunction("__invokeTool",(r,o)=>{let s=e.getString(r),n=e.getString(o);try{let r=t.invokeTool(s,n);return e.newString(r)}catch(t){return throwError(e,t.message||"tool invocation failed")}});e.setProp(e.global,"__invokeTool",r),r.dispose()}let R=jsToHandle(e,r.env);e.setProp(e.global,"env",R),R.dispose();let A=e.newObject(),k=jsToHandle(e,[r.scriptPath||"js-exec",...r.args]);e.setProp(A,"argv",k),k.dispose();let F=e.newFunction("cwd",()=>e.newString(r.cwd));e.setProp(A,"cwd",F),F.dispose();let j=e.newFunction("exit",r=>{let s=0;if(r){let t=e.dump(r);s="number"==typeof t?t:0}t.exit(s);let n=e.newError("process.exit()");return e.setProp(n,PROCESS_EXIT_MARKER,o),{error:n}});e.setProp(A,"exit",j),j.dispose(),e.setProp(e.global,"process",A),A.dispose();let D=e.evalCode(`(function() {
  // Bridge native handles from string keys (set by QuickJS setProp) to symbol keys
  globalThis[Symbol.for('jb:fetch')] = globalThis.__fetch;
  globalThis[Symbol.for('jb:exec')] = globalThis.__exec;
  globalThis[Symbol.for('jb:execArgs')] = globalThis.__execArgs;
  delete globalThis.__fetch;
  delete globalThis.__exec;
  delete globalThis.__execArgs;

  var _fs = globalThis.fs;
  // Save original native functions
  var orig = Object.create(null);
  var allNames = [
    'readFile', 'readFileBuffer', 'writeFile', 'stat', 'lstat', 'readdir',
    'mkdir', 'rm', 'exists', 'appendFile', 'symlink', 'readlink',
    'chmod', 'realpath', 'rename', 'copyFile'
  ];
  for (var i = 0; i < allNames.length; i++) {
    orig[allNames[i]] = _fs[allNames[i]];
  }

  // Wrap async-style methods to always throw (matching Node.js which requires a callback).
  // In Node.js, calling fs.readFile() without a callback throws TypeError.
  // We don't support callbacks, so the async form always errors.
  function wrapCb(fn, name) {
    return function() {
      throw new Error(
        "fs." + name + "() with callbacks is not supported. " +
        "Use fs." + name + "Sync() or fs.promises." + name + "() instead."
      );
    };
  }
  var cbNames = [
    'readFile', 'writeFile', 'stat', 'lstat', 'readdir', 'mkdir',
    'rm', 'appendFile', 'symlink', 'readlink', 'chmod', 'realpath',
    'rename', 'copyFile'
  ];
  for (var i = 0; i < cbNames.length; i++) {
    if (orig[cbNames[i]]) _fs[cbNames[i]] = wrapCb(orig[cbNames[i]], cbNames[i]);
  }
  // exists: callback is especially common in legacy Node.js
  _fs.exists = wrapCb(orig.exists, 'exists');

  // readFileSync: match Node.js behavior
  // - No encoding: return Buffer
  // - With encoding (e.g. 'utf8'): return string
  _fs.readFileSync = function(path, opts) {
    var encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    if (encoding) return orig.readFile(path);
    return Buffer.from(orig.readFileBuffer(path));
  };
  _fs.writeFileSync = orig.writeFile;
  _fs.statSync = orig.stat;
  _fs.lstatSync = orig.lstat;
  _fs.readdirSync = orig.readdir;
  _fs.mkdirSync = orig.mkdir;
  _fs.rmSync = orig.rm;
  _fs.existsSync = orig.exists;
  _fs.appendFileSync = orig.appendFile;
  _fs.symlinkSync = orig.symlink;
  _fs.readlinkSync = orig.readlink;
  _fs.chmodSync = orig.chmod;
  _fs.realpathSync = orig.realpath;
  _fs.renameSync = orig.rename;
  _fs.copyFileSync = orig.copyFile;
  _fs.unlinkSync = orig.rm;
  _fs.rmdirSync = orig.rm;
  _fs.unlink = wrapCb(orig.rm, 'unlink');
  _fs.rmdir = wrapCb(orig.rm, 'rmdir');

  // promises namespace
  _fs.promises = {};
  for (var i = 0; i < allNames.length; i++) {
    var m = allNames[i];
    (function(fn) {
      _fs.promises[m] = function() {
        try { return Promise.resolve(fn.apply(null, arguments)); }
        catch(e) { return Promise.reject(e); }
      };
    })(orig[m]);
  }
  // Override promises.readFile to match Node.js behavior (Buffer vs string)
  _fs.promises.readFile = function(path, opts) {
    var encoding = typeof opts === 'string' ? opts : (opts && opts.encoding);
    try {
      if (encoding) return Promise.resolve(orig.readFile(path));
      return Promise.resolve(Buffer.from(orig.readFileBuffer(path)));
    } catch(e) { return Promise.reject(e); }
  };
  _fs.promises.unlink = _fs.promises.rm;
  _fs.promises.rmdir = _fs.promises.rm;
  _fs.promises.access = function(p) {
    return orig.exists(p) ? Promise.resolve() : Promise.reject(new Error('ENOENT: no such file or directory: ' + p));
  };

  // process enhancements
  var _p = globalThis.process;
  _p.env = globalThis.env;
  _p.platform = 'linux';
  _p.arch = 'x64';
  _p.versions = { node: '22.0.0', quickjs: '2024' };
  _p.version = 'v22.0.0';

  // Initialize path module on globalThis so require('path') works
  ${PATH_MODULE_SOURCE}

  // Initialize fetch polyfill (URL, Headers, Request, Response, fetch)
  ${FETCH_POLYFILL_SOURCE}

  // Initialize additional module shims
  ${EVENTS_MODULE_SOURCE}
  ${OS_MODULE_SOURCE}
  ${URL_MODULE_SOURCE}
  ${ASSERT_MODULE_SOURCE}
  ${UTIL_MODULE_SOURCE}
  ${BUFFER_MODULE_SOURCE}
  ${STREAM_MODULE_SOURCE}
  ${STRING_DECODER_MODULE_SOURCE}
  ${QUERYSTRING_MODULE_SOURCE}

  // Wrap console methods to auto-stringify Buffer arguments.
  // In Node.js, console.log(buffer) calls util.inspect \u2192 toString().
  (function() {
    var _cl = console.log;
    var _ce = console.error;
    var _cw = console.warn;
    function fix(a) { return a instanceof Buffer ? a.toString() : a; }
    function wrap(fn) {
      return function() {
        var a = [];
        for (var i = 0; i < arguments.length; i++) a.push(fix(arguments[i]));
        return fn.apply(console, a);
      };
    }
    console.log = wrap(_cl);
    console.error = wrap(_ce);
    console.warn = wrap(_cw);
  })();

  // require() shim for CommonJS compatibility
  var _execFn = globalThis[Symbol.for('jb:exec')];
  var _execArgsFn = globalThis[Symbol.for('jb:execArgs')];
  var _childProcess = {
    exec: function(cmd, opts) { return _execFn(cmd, opts); },
    execSync: function(cmd, opts) {
      var r = _execFn(cmd, opts);
      if (r.exitCode !== 0) {
        var e = new Error('Command failed: ' + cmd);
        e.status = r.exitCode;
        e.stderr = r.stderr;
        e.stdout = r.stdout;
        throw e;
      }
      return r.stdout;
    },
    spawnSync: function(cmd, args, opts) {
      var r = _execArgsFn(cmd, args || []);
      return { stdout: r.stdout, stderr: r.stderr, status: r.exitCode };
    }
  };

  var _modules = Object.create(null);
  _modules.fs = _fs;
  _modules.path = globalThis[Symbol.for('jb:path')];
  _modules.child_process = _childProcess;
  _modules.process = _p;
  _modules.console = globalThis.console;
  _modules.os = globalThis[Symbol.for('jb:os')];
  _modules.url = globalThis[Symbol.for('jb:url')];
  _modules.assert = globalThis[Symbol.for('jb:assert')];
  _modules.util = globalThis[Symbol.for('jb:util')];
  _modules.events = globalThis[Symbol.for('jb:events')];
  _modules.buffer = globalThis[Symbol.for('jb:buffer')];
  _modules.stream = globalThis[Symbol.for('jb:stream')];
  _modules.string_decoder = globalThis[Symbol.for('jb:string_decoder')];
  _modules.querystring = globalThis[Symbol.for('jb:querystring')];

  var _unsupported = Object.create(null);
  var _unsupportedRaw = ${JSON.stringify(UNSUPPORTED_MODULES)};
  Object.keys(_unsupportedRaw).forEach(function(_key) {
    _unsupported[_key] = _unsupportedRaw[_key];
  });

  globalThis.require = function(name) {
    if (name.startsWith('node:')) name = name.slice(5);
    if (Object.prototype.hasOwnProperty.call(_modules, name)) {
      return _modules[name];
    }
    if (Object.prototype.hasOwnProperty.call(_unsupported, name)) {
      var hint = _unsupported[name];
      throw new Error("Module '" + name + "' is not available in the js-exec sandbox. " + hint + " Run 'js-exec --help' for available modules.");
    }
    throw new Error("Cannot find module '" + name + "'. Run 'js-exec --help' for available modules.");
  };
  globalThis.require.resolve = function(name) { return name; };
})();`,"<compat>");D.error?D.error.dispose():D.value.dispose()}var originalProcessExit=process.exit.bind(process);process.on("uncaughtException",()=>{originalProcessExit(1)});var defense=null;async function initializeWithDefense(){await getQuickJSModule();try{e("const x = 1;")}catch{}await t(0),defense=new WorkerDefenseInDepth({excludeViolationTypes:["shared_array_buffer","atomics","process_stdout","process_stderr"]})}var TOOLS_PROXY_SETUP_SOURCE=`(function() {
  globalThis.tools = (function makeProxy(path) {
    return new Proxy(function(){}, {
      get: function(_t, prop) {
        if (prop === 'then' || typeof prop === 'symbol') return undefined;
        return makeProxy(path.concat([String(prop)]));
      },
      apply: function(_t, _this, args) {
        var toolPath = path.join('.');
        if (!toolPath) throw new Error('Tool path missing in invocation');
        var argsJson = args.length > 0 ? JSON.stringify(args[0]) : '';
        if (argsJson === undefined) argsJson = '';
        var resultJson = globalThis.__invokeTool(toolPath, argsJson);
        return resultJson !== undefined && resultJson !== '' ? JSON.parse(resultJson) : undefined;
      }
    });
  })([]);
})();`;async function executeCode(t){let r,o,s,n=await getQuickJSModule(),i=new SyncBackend(t.sharedBuffer,t.timeoutMs);try{(r=n.newRuntime()).setMemoryLimit(MEMORY_LIMIT);let a=0;r.setInterruptHandler(()=>++a>INTERRUPT_CYCLES),s=(o=r.newContext()).newObject(),setupContext(o,i,t,s);{let e=o.evalCode(`{
          // --- Block dynamic code compilation ---
          // @banned-pattern-ignore: intentional sandbox hardening \u2014 removes eval/Function inside QuickJS guest, not the host
          Object.defineProperty(globalThis, 'eval', {
            value: undefined,
            writable: false,
            configurable: false,
          });
          const BlockedFunction = function () {
            throw new TypeError('Function constructor is not allowed');
          };
          const OrigFunction = Function;
          BlockedFunction.prototype = OrigFunction.prototype;

          // Capture function-type constructors before we patch them
          const AsyncFunction = (async function(){}).constructor;
          const GeneratorFunction = (function*(){}).constructor;
          const AsyncGeneratorFunction = (async function*(){}).constructor;

          // Patch .constructor on all function-type prototypes
          for (const proto of [
            OrigFunction.prototype,
            AsyncFunction.prototype,
            GeneratorFunction.prototype,
            AsyncGeneratorFunction.prototype,
          ]) {
            Object.defineProperty(proto, 'constructor', {
              value: BlockedFunction,
              writable: false,
              configurable: false,
            });
          }
          // @banned-pattern-ignore: intentional sandbox hardening \u2014 replaces Function constructor inside QuickJS guest
          Object.defineProperty(globalThis, 'Function', {
            value: BlockedFunction,
            writable: false,
            configurable: false,
          });

          // --- Freeze all intrinsic prototypes ---
          // Prevents prototype pollution (e.g. Array.prototype.x = ...).
          // Only language intrinsics \u2014 not sandbox-injected objects
          // (process, console, require) which need to stay mutable.
          // Error prototypes are excluded: freezing them makes the inherited
          // "message" property non-writable, which prevents new Error instances
          // from having their own "message" set (JS spec OrdinarySet step 4).
          const g = globalThis;
          const toFreeze = [
            Object, Object.prototype,
            OrigFunction, OrigFunction.prototype,
            AsyncFunction, AsyncFunction.prototype,
            GeneratorFunction, GeneratorFunction.prototype,
            AsyncGeneratorFunction, AsyncGeneratorFunction.prototype,
            Array, Array.prototype,
            String, String.prototype,
            Number, Number.prototype,
            Boolean, Boolean.prototype,
            g.Symbol, g.Symbol && g.Symbol.prototype,
            RegExp, RegExp.prototype,
            Date, Date.prototype,
            Map, Map.prototype,
            Set, Set.prototype,
            WeakMap, WeakMap.prototype,
            WeakSet, WeakSet.prototype,
            g.WeakRef, g.WeakRef && g.WeakRef.prototype,
            Promise, Promise.prototype,
            ArrayBuffer, ArrayBuffer.prototype,
            g.SharedArrayBuffer, g.SharedArrayBuffer && g.SharedArrayBuffer.prototype,
            g.DataView, g.DataView && g.DataView.prototype,
            JSON, Math, g.Reflect, g.Proxy, g.Atomics,
            g.BigInt, g.BigInt && g.BigInt.prototype,
            BlockedFunction,
          ];
          // TypedArrays (guard against missing globals in QuickJS)
          for (const name of [
            'Int8Array','Uint8Array','Uint8ClampedArray',
            'Int16Array','Uint16Array','Int32Array','Uint32Array',
            'Float32Array','Float64Array',
            'BigInt64Array','BigUint64Array',
          ]) {
            if (g[name]) {
              toFreeze.push(g[name], g[name].prototype);
            }
          }
          // %TypedArray% intrinsic (shared base)
          if (g.Uint8Array) {
            const taProto = Object.getPrototypeOf(g.Uint8Array.prototype);
            if (taProto && taProto !== Object.prototype) toFreeze.push(taProto);
            const taCtor = Object.getPrototypeOf(g.Uint8Array);
            if (taCtor && taCtor !== OrigFunction.prototype) toFreeze.push(taCtor);
          }
          // Iterator prototypes
          try {
            const arrIterProto = Object.getPrototypeOf(
              Object.getPrototypeOf([][Symbol.iterator]())
            );
            if (arrIterProto) {
              toFreeze.push(arrIterProto);
              const iterProto = Object.getPrototypeOf(arrIterProto);
              if (iterProto) toFreeze.push(iterProto);
            }
          } catch {}
          try {
            toFreeze.push(Object.getPrototypeOf(new Map()[Symbol.iterator]()));
          } catch {}
          try {
            toFreeze.push(Object.getPrototypeOf(new Set()[Symbol.iterator]()));
          } catch {}
          try {
            toFreeze.push(Object.getPrototypeOf(''[Symbol.iterator]()));
          } catch {}
          try {
            const genObj = (function*(){})();
            toFreeze.push(Object.getPrototypeOf(genObj));
            toFreeze.push(Object.getPrototypeOf(Object.getPrototypeOf(genObj)));
          } catch {}
          try {
            const asyncGenObj = (async function*(){})();
            toFreeze.push(Object.getPrototypeOf(asyncGenObj));
            toFreeze.push(Object.getPrototypeOf(Object.getPrototypeOf(asyncGenObj)));
          } catch {}

          for (const obj of toFreeze) {
            if (obj != null) {
              try { Object.freeze(obj); } catch {}
            }
          }
        }`,"<sandbox-init>");if(e.error){let t=o.dump(e.error);e.error.dispose();let r="object"==typeof t&&null!==t&&"message"in t?t.message:String(t);return i.writeStderr(`js-exec: sandbox hardening failed: ${r}
`),i.exit(1),{success:!0}}e.value.dispose()}if(t.isModule&&r.setModuleLoader(t=>{if(Object.hasOwn(VIRTUAL_MODULES,t))return VIRTUAL_MODULES[t];try{let r=i.readFile(t),o=new TextDecoder().decode(r);return(t.endsWith(".ts")||t.endsWith(".mts"))&&(o=e(o)),o}catch(e){return{error:Error(`Cannot find module '${t}': ${e.message}`)}}},(e,r)=>(r.startsWith("node:")&&(r=r.slice(5)),r.startsWith("./")||r.startsWith("../")||r.startsWith("/"))?resolveModulePath(r,"<eval>"===e?void 0:e,t.cwd):r),t.bootstrapCode){let e=o.evalCode(t.bootstrapCode,"bootstrap.js");if(e.error){let t=o.dump(e.error);e.error.dispose();let r=formatError(t);return i.writeStderr(`js-exec: bootstrap error: ${r}
`),i.exit(1),{success:!0}}e.value.dispose()}if(t.hasInvokeTool){let e=o.evalCode(TOOLS_PROXY_SETUP_SOURCE,"<tools-setup>");e.error?e.error.dispose():e.value.dispose()}let c=t.scriptPath||"<eval>",l=t.jsCode;t.stripTypes&&(l=e(l));let p=t.isModule?o.evalCode(l,c,{type:"module"}):o.evalCode(l,c);if(p.error){if(isProcessExit(o,p.error,s))return p.error.dispose(),{success:!0};let e=o.dump(p.error);p.error.dispose();let t=formatError(e);try{i.writeStderr(`${t}
`)}catch{}return i.exit(1),{success:!0}}let u=t.isModule?o.resolvePromise(p.value):void 0,f=r.executePendingJobs();if("error"in f&&f.error){if(isProcessExit(o,f.error,s))return f.error.dispose(),p.value.dispose(),{success:!0};let e=o.dump(f.error);f.error.dispose(),p.value.dispose();let t=formatError(e);try{i.writeStderr(`${t}
`)}catch{}return i.exit(1),{success:!0}}if(u){let e=await u;if(e.error){if(isProcessExit(o,e.error,s))return e.error.dispose(),p.value.dispose(),{success:!0};let t=o.dump(e.error);e.error.dispose(),p.value.dispose();let r=formatError(t);try{i.writeStderr(`${r}
`)}catch{}return i.exit(1),{success:!0}}e.value.dispose()}return p.value.dispose(),i.exit(0),{success:!0,defenseStats:defense?.getStats()}}catch(t){let e=t instanceof Error?t.message:String(t);try{i.writeStderr(`js-exec: ${e}
`)}catch{}try{i.exit(1)}catch{return{success:!1,error:e}}return{success:!0}}finally{s?.dispose(),o?.dispose(),r?.dispose()}}var initPromise=initializeWithDefense();initPromise.catch(e=>{initializationFailure=e}),r?.on("message",async e=>{let t=!1;try{if(void 0!==initializationFailure)throw initializationFailure;try{await initPromise}catch(e){throw initializationFailure=e,e}if(void 0!==initializationFailure)throw initializationFailure;t=!0;let o=await executeCode(e);o.defenseStats=defense?.getStats(),o.protocolToken=e.protocolToken,r?.postMessage(o)}catch(o){r?.postMessage({protocolToken:e.protocolToken,type:t?void 0:"initialization-failure",success:!1,error:o instanceof Error?o.message:String(o),defenseStats:defense?.getStats()})}});