 'use strict';
const fs=require('node:fs'), c=require('./candidate_frames.cjs');
const ids=['labels-roundtrip','unicode-surrogate','root-target','getter-nonprimitive','label-proof','reserved-prefix','length-truncate-tail','boundary-header','body-cap','aggregate-cap','candidate-cap','call-cap','ordinal','fragment-coalesce','late','unfinished','reentry-finish','sinkthrow'];
let ec=0,dc=0,rc=0,pc=0;const E=p=>{ec++;return c.encode(p)},D=f=>{dc++;return c.decode(f)},R=(sink=()=>{})=>{rc++;return c.createReader(sink,()=>{})},P=(r,b)=>{pc++;return r.push(b)};
function pkt(k=1,o=1,b=''){return {kind:'candidate',ordinal:o,headerBoundary:[null,'node-http1-header-cache','undici-h1-prefix','undici-h2-text-view'][k],bodyBoundary:k===1?'primitive-utf8-end-argument':'diagnostic-chunks-at-callback',header:k===3?':method: POST\r\n:path: /v1/responses\r\n':'POST /v1/responses HTTP/1.1\r\n\r\n',body:b,requestCompletenessProved:false,wireReceiptProved:false}}
const eq=(a,b)=>Object.keys(a).every(k=>a[k]===b[k]); const f=()=>E(pkt());
function feed(r,b){let ok=true;for(let i=0;i<b.length;i+=65536)ok=P(r,b.subarray(i,i+65536))&&ok;return ok}
const tests=[
()=>[1,2,3].every(k=>{let p=pkt(k);return eq(p,D(E(p)))}),
()=>{let p=pkt(3,1,'\u4e2d\ud800x\udfff\ud83d\ude00');return eq(p,D(E(p)))},
()=>{let p=pkt();p.header='POST / HTTP/1.1\r\nx-amz-target: AmazonCodeWhispererStreamingService.GenerateAssistantResponse\r\n\r\n';let ok=!!D(E(p));p.header=p.header.replace('x-amz-target:','other:');return ok&&E(p)===null},
()=>{let hits=0,p=pkt();Object.defineProperty(p,'body',{get(){hits++;return ''}});return E(p)===null&&hits===0&&E({...pkt(),body:new String('')})===null&&E({...pkt(),header:new String('')})===null},
()=>E({...pkt(),headerBoundary:'unknown'})===null&&E({...pkt(),requestCompletenessProved:true})===null&&E({...pkt(),wireReceiptProved:true})===null,
()=>[0,4,5,6,7].every(i=>{let b=f();b[i]=i===4?4:i===5?0:255;return D(b)===null}),
()=>{let b=f(),x=Buffer.from(b);x.writeUInt32BE(65537,8);let y=Buffer.from(b);y.writeUInt32BE(262145,12);return D(x)===null&&D(y)===null&&D(b.subarray(0,15))===null&&D(b.subarray(0,b.length-1))===null&&D(Buffer.concat([b,Buffer.alloc(1)]))===null},
()=>E({...pkt(),bodyBoundary:'unknown'})===null&&E({...pkt(),header:pkt(3).header})===null&&E({...pkt(),header:'POST /v1/responses HTTP/1.1\r\n'})===null&&E({...pkt(),header:'POST /v1/responses HTTP/1.1\r\nx: \u4e2d\r\n\r\n'})===null,
()=>!!E(pkt(1,1,'a'.repeat(262144)))&&E(pkt(1,1,'a'.repeat(262145)))===null&&E(pkt(1,1,'\u4e2d'.repeat(87382)))===null,
()=>{let r=R();let a=feed(r,E(pkt(1,1,'a'.repeat(262144))))&&feed(r,E(pkt(1,2,'a'.repeat(262144))));let b=feed(r,E(pkt(1,3,'x')));return a&&!b&&r.finish().fault==='aggregate-cap'},
()=>{let r=R();for(let i=1;i<=4;i++)if(!P(r,E(pkt(1,i))))return false;return !P(r,E(pkt(2,1)))&&r.finish().fault==='frame-cap'},
()=>{let r=R();for(let i=0;i<1024;i++)if(!P(r,Buffer.alloc(0)))return false;return !P(r,Buffer.alloc(0))&&r.finish().fault==='call-cap'&&r.snapshot().calls===1024},
()=>{let r=R(),s=R();let a=!P(r,E(pkt(1,2)))&&r.finish().fault==='invalid-ordinal';let b=P(s,E(pkt(2,1)))&&!P(s,E(pkt(3,1)))&&s.finish().fault==='invalid-ordinal';return a&&b&&E(pkt(1,0))===null&&E(pkt(1,5))===null},
()=>{let n=0,r=R(()=>n++),b=Buffer.concat([E(pkt(1,1)),E(pkt(2,1)),E(pkt(3,2))]);let ok=P(r,b.subarray(0,7))&&P(r,b.subarray(7,19))&&P(r,b.subarray(19));return ok&&n===3&&r.finish().fault==='none'},
()=>{let r=R();r.finish();return !P(r,f())&&r.finish().fault==='late-input'},
()=>{let r=R();P(r,f().subarray(0,17));return r.finish().fault==='truncated-frame'},
()=>{let a,b;a=R(()=>P(a,Buffer.alloc(0)));b=R(()=>b.finish());return !P(a,f())&&a.finish().fault==='reentrant-input'&&!P(b,f())&&b.finish().fault==='finish-pending'},
()=>{let r=R(()=>{throw 0});return !P(r,f())&&r.finish().fault==='sink-threw'&&!P(r,f())&&r.snapshot().delivered===0}
];
const results=[];for(let i=0;i<tests.length;i++){let passed=false;try{passed=tests[i]()===true}catch{}results.push({id:ids[i],passed})}
const result={schema:1,executionCount:1,node:process.version,platform:process.platform,arch:process.arch,pid:process.pid,actualCases:results.length,passed:results.filter(x=>x.passed).length,encodeCalls:ec,decodeCalls:dc,readerCreates:rc,pushInvocations:pc,results};
fs.writeFileSync(__dirname+'/result.json',JSON.stringify(result),{flag:'wx',mode:0o600});process.exitCode=result.passed===18?0:1;
