(async()=>{
const url="https://raw.githubusercontent.com/apple-oss-distributions/xnu/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/sys/coalition_private.h", cap=1048576, ac=new AbortController();
if(location.href!=='about:blank') return {url,status:null,complete:false,error:{name:'OwnedPageMismatch',message:'not expected blank page'}};
const timer=setTimeout(()=>ac.abort(),8000);
let status=null, total=0, complete=false, capped=false, parts=[];
try {
 const r=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store',signal:ac.signal});
 status=r.status;
 const reader=r.body.getReader();
 while(true){
  const v=await reader.read(); if(v.done){complete=true;break;}
  if(total+v.value.length>cap){capped=true;await reader.cancel();break;}
  total+=v.value.length;parts.push(v.value);
 }
 const all=new Uint8Array(total);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}
 let binary='';for(let i=0;i<all.length;i+=16384)binary+=String.fromCharCode(...all.subarray(i,i+16384));
 return {url,status,complete,capped,bytes:total,bodyBase64:btoa(binary),contentType:r.headers.get('content-type'),responseUrl:r.url};
} catch(e){return {url,status,complete:false,capped,bytes:total,error:{name:e.name,message:String(e.message).slice(0,512)}};}
finally{clearTimeout(timer);}
})()