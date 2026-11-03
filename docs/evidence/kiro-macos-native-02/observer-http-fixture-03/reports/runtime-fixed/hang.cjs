'use strict';
const fs=require('node:fs');const p=process.env.TMPDIR;
process.on('SIGTERM',()=>{});
if(process.argv[2]==='earlylate'){
 const ev=[{kind:'request',id:1,method:'GET',path:'/owned'},{kind:'request-call',api:'http.request',originalReturned:true,id:1},{kind:'header-cache',id:1,value:'GET /owned HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n'},{kind:'end',id:1,originalReturned:true,returnType:'object',returnIsThis:true,booleanReturn:null,bytes:0,bodyBase64:''}];
 const raw=ev.map(x=>JSON.stringify(x)+'\n').join('');const status=JSON.stringify({ok:true,reason:null,events:4,bodyBytes:0,logBytes:Buffer.byteLength(raw),requests:1,pendingBodyBytes:0});
 fs.writeFileSync(p+'/early.trace',raw,{flag:'wx'});fs.writeFileSync(p+'/early.status',status,{flag:'wx'});
 setTimeout(()=>{fs.writeFileSync(p+'/late.trace',raw,{flag:'wx'});fs.writeFileSync(p+'/late.status',status,{flag:'wx'});},350);
}
setInterval(()=>{},1000);
