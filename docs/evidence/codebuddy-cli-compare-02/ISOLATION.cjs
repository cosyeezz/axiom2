'use strict';
// Import-safe process-local filesystem/process guards. Never an OS sandbox.
module.exports = function isolate({ roots, state, allowMetadata = false }) {
  const fs=require('node:fs'),cp=require('node:child_process'),wt=require('node:worker_threads');
  const {PassThrough}=require('node:stream'),{EventEmitter}=require('node:events');
  const {resolve,dirname,relative}=require('node:path');const realpath=fs.realpathSync.bind(fs),exists=fs.existsSync.bind(fs);
  const owned=roots.filter(Boolean).map(root=>realpath(root));
  const allowed = value => { if(typeof value!=='string')return false;const path=resolve(value);let parent=path;while(!exists(parent)&&dirname(parent)!==parent)parent=dirname(parent);const actual=realpath(parent),canonical=resolve(actual,relative(parent,path));return owned.some(root=>(canonical===root||canonical.startsWith(root+'/'))&&(actual===root||actual.startsWith(root+'/'))); };
  for(const key of ['writeFileSync','appendFileSync','renameSync','copyFileSync','truncateSync','chmodSync','chownSync','linkSync','symlinkSync','fchmodSync','fchownSync','ftruncateSync','utimesSync','futimesSync','lutimesSync'])if(fs[key])fs[key]=()=>{state.writesSuppressed++;};
  for(const key of ['writeFile','appendFile','rename','copyFile','truncate','chmod','chown','link','symlink','fchmod','fchown','ftruncate','utimes','futimes','lutimes']){
    fs[key]=(...args)=>{state.writesSuppressed++;const cb=args.at(-1);if(typeof cb==='function')queueMicrotask(()=>cb(null));};
    if(fs.promises[key])fs.promises[key]=async()=>{state.writesSuppressed++;};
  }
  const writing=flags=>typeof flags==='number'?!!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR)):/[wa+]/.test(flags);
  const openSync=fs.openSync.bind(fs),open=fs.open.bind(fs),promiseOpen=fs.promises.open.bind(fs.promises),stream=fs.createWriteStream.bind(fs);
  fs.openSync=(path,flags,mode)=>{if(writing(flags)){state.writesSuppressed++;return openSync('/dev/null','w');}return openSync(path,flags,mode);};
  fs.open=(path,flags,...rest)=>{if(writing(flags)){state.writesSuppressed++;return open('/dev/null','w',rest.at(-1));}return open(path,flags,...rest);};
  fs.promises.open=(path,flags,mode)=>{if(writing(flags)){state.writesSuppressed++;return promiseOpen('/dev/null','w');}return promiseOpen(path,flags,mode);};
  fs.createWriteStream=(_path,options)=>{state.writesSuppressed++;const clean=typeof options==='object'?{...options}:options;if(clean&&typeof clean==='object'){delete clean.fd;delete clean.fs;}return stream('/dev/null',clean);};
  const writeSync=fs.writeSync.bind(fs),write=fs.write.bind(fs);
  fs.writeSync=(fd,data,...args)=>{if(fd===1||fd===2)return writeSync(fd,data,...args);state.writesSuppressed++;return typeof data==='string'?Buffer.byteLength(data):args[1]??data.byteLength;};
  fs.write=(fd,data,...args)=>{if(fd===1||fd===2)return write(fd,data,...args);state.writesSuppressed++;const cb=args.at(-1);if(typeof cb==='function')queueMicrotask(()=>cb(null,typeof data==='string'?Buffer.byteLength(data):data.byteLength,data));};
  fs.writevSync=(_fd,buffers)=>{state.writesSuppressed++;return buffers.reduce((n,b)=>n+b.byteLength,0);};
  fs.writev=(_fd,buffers,...args)=>{state.writesSuppressed++;const cb=args.at(-1);if(typeof cb==='function')queueMicrotask(()=>cb(null,buffers.reduce((n,b)=>n+b.byteLength,0),buffers));};
  for(const key of ['mkdirSync','rmSync','rmdirSync','unlinkSync']){const original=fs[key].bind(fs);fs[key]=(path,...args)=>{if(!allowed(path))throw Error('OWNED_PATH_REQUIRED');return original(path,...args);};}
  for(const key of ['mkdir','rm','rmdir','unlink']){
    const original=fs[key].bind(fs);fs[key]=(path,...args)=>{if(!allowed(path)){const cb=args.at(-1);if(typeof cb==='function')return queueMicrotask(()=>cb(Error('OWNED_PATH_REQUIRED')));throw Error('OWNED_PATH_REQUIRED');}return original(path,...args);};
    const promise=fs.promises[key].bind(fs.promises);fs.promises[key]=async(path,...args)=>{if(!allowed(path))throw Error('OWNED_PATH_REQUIRED');return promise(path,...args);};
  }
  const permitted=(key,args)=>allowMetadata&&((key==='execSync'&&args[0]==='ioreg -rd1 -c IOPlatformExpertDevice')||((key==='execFile'||key==='execFileSync')&&args[0]==='/usr/sbin/scutil'&&JSON.stringify(args[1])==='["--proxy"]'));
  const metadata=(key,args,original)=>{state.metadataReads++;const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]])),options=key==='execSync'?args[1]:args[2],safe={env,timeout:5000,maxBuffer:65536,encoding:options?.encoding==='utf8'?'utf8':null};if(key==='execSync')return original('/usr/sbin/ioreg -rd1 -c IOPlatformExpertDevice',{...safe,shell:'/bin/sh'});return key==='execFile'?original(args[0],args[1],{...safe,shell:false},typeof args[2]==='function'?args[2]:args[3]):original(args[0],args[1],{...safe,shell:false});};
  for(const key of ['spawnSync','execSync','execFileSync']){const original=cp[key].bind(cp);cp[key]=(...args)=>{if(permitted(key,args))return metadata(key,args,original);state.childrenBlocked++;throw Error('CHILD_BLOCKED');};}
  for(const key of ['spawn','exec','execFile','fork']){const original=cp[key].bind(cp);cp[key]=(...args)=>{
    if(permitted(key,args))return metadata(key,args,original);
    state.childrenBlocked++;const error=Object.assign(Error('CHILD_BLOCKED'),{code:'EACCES',status:1,stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)}),child=new EventEmitter();
    child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.kill=()=>true;child.ref=child.unref=()=>child;child.exitCode=1;child.signalCode=null;
    process.nextTick(()=>{const cb=args.at(-1);if((key==='exec'||key==='execFile')&&typeof cb==='function')cb(error,'','');else if(child.listenerCount('error'))child.emit('error',error);child.stdout.end();child.stderr.end();child.emit('close',1,null);});return child;
  };}
  wt.Worker=class{constructor(){state.childrenBlocked++;throw Error('WORKER_BLOCKED');}};
};
