const {spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const env={...process.env};for(const key of Object.keys(env))if(/^(QODER|QODERCN)/i.test(key))delete env[key];
Object.assign(env,{QODER_CONFIG_DIR:path.join(__dirname,'cli-home'),QODERCN_CONFIG_DIR:path.join(__dirname,'cli-home-cn'),NO_BROWSER:'1',NODE_OPTIONS:''});
const runs=[];
for(const flag of ['--version','--list-models']){
 const args=['--require',path.join(__dirname,'offline-preload.cjs'),path.join(__dirname,'official/package/bundle/qodercli.js'),flag];
 const run=spawnSync(process.execPath,args,{cwd:path.join(__dirname,'cli-workspace'),env,encoding:'utf8',timeout:20000,maxBuffer:2*1024*1024,windowsHide:true});
 const record={flag,args,status:run.status,signal:run.signal,error:run.error?.message,stdout:run.stdout,stderr:run.stderr};
 runs.push(record);console.log(JSON.stringify(record,null,2));
}
fs.writeFileSync(path.join(__dirname,'cli-probes.json'),JSON.stringify(runs,null,2));
