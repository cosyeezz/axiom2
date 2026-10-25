// Read-only candidate discovery. Validate against the linked dumpbin instructions.
const fs = require('node:fs'), crypto = require('node:crypto'), cp = require('node:child_process'), path = require('node:path');
const source = 'C:/Users/dane/AppData/Local/Kiro-Cli/kiro-cli.exe';
const b = fs.readFileSync(source), pe = b.readUInt32LE(60), opt = pe + 24;
const base = Number(b.readBigUInt64LE(opt + 24)), table = opt + b.readUInt16LE(pe + 20);
const sections = Array.from({length:b.readUInt16LE(pe+6)},(_,i)=>{const p=table+i*40;return {rva:b.readUInt32LE(p+12),size:b.readUInt32LE(p+16),off:b.readUInt32LE(p+20)};});
const r2f = r => {const s=sections.find(s=>r>=s.rva&&r<s.rva+s.size);return s?s.off+r-s.rva:null;};
const ranges = { user:['140b95c80','140b97aa4'], assistant:['140bae5a0','140baf25f'] };
const exceptionRva=b.readUInt32LE(opt+112+3*8), exceptionBytes=b.readUInt32LE(opt+112+3*8+4), exceptionOffset=r2f(exceptionRva);
for(let p=exceptionOffset;p<exceptionOffset+exceptionBytes;p+=12) {
  const start=base+b.readUInt32LE(p),end=base+b.readUInt32LE(p+4);
  if(start===0x140b80040) ranges.reasoning=[start.toString(16),end.toString(16)];
}
if(!ranges.reasoning) throw Error('reasoning callee not found in exception table');
const fields = [];
for(const [owner,[start,end]] of Object.entries(ranges)) {
  const lo=r2f(parseInt(start,16)-base),hi=r2f(parseInt(end,16)-base);
  for(let p=lo;p<hi-32;p++) {
    if(b[p]!==0x48||b[p+1]!==0x8d||![0x05,0x15].includes(b[p+2])) continue;
    const va=base+(p-lo)+(parseInt(start,16)-base), target=va+7+b.readInt32LE(p+3), off=r2f(target-base);
    if(off===null) continue;
    const keyCalls=[];
    for(let c=p+7;c<Math.min(p+36,hi-5);c++) if(b[c]===0xe8 && va+(c-p)+5+b.readInt32LE(c+1)===0x1410c81b0) keyCalls.push(c);
    if(!keyCalls.length) continue;
    const call=keyCalls[0]; let len;
    for(let q=Math.max(lo,p-12);q<call-5;q++) if(b[q]===0x41&&b[q+1]===0xb8) len=b.readUInt32LE(q+2);
    if(len>0&&len<=64) {
      const name=b.toString('ascii',off,off+len);
      if(/^[A-Za-z][A-Za-z0-9]*$/.test(name)) fields.push({owner,field:name,instructionVA:'0x'+va.toString(16),stringVA:'0x'+target.toString(16),keyHelperCallVA:'0x'+(va+call-p).toString(16),fileOffset:off,length:len});
    }
  }
}
const identity={source,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')};
if(identity.sha256!=='0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a') throw Error('CLI identity changed');
const exe='C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207/bin/Hostx64/x64/dumpbin.exe';
const runs=[];
for(const owner of ['assistant','reasoning']) {
  const [start,end]=ranges[owner],args=['/nologo','/disasm',`/range:0x${start},0x${end}`,source];
  const run=cp.spawnSync(exe,args,{encoding:'utf8',maxBuffer:4e6});
  fs.writeFileSync(path.join(__dirname,owner+'.asm.txt'),run.stdout||'');
  runs.push({exe,args,exitCode:run.status,stderr:run.stderr,error:run.error?.message});
}
fs.writeFileSync(path.join(__dirname,'dumpbin-run.json'),JSON.stringify(runs,null,2)+'\n');
if(runs.some(r=>r.exitCode!==0)) throw Error('dumpbin failed');
const out={...identity,method:'RIP-relative LEA RAX/RDX plus MOV R8D length before the common JSON-key helper (0x1410c81b0) in previously identified serializers; validate instructions against dumpbin. No caller value/field presence/default proof.',fields};
fs.writeFileSync(path.join(__dirname,'serializer-fields.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify(out,null,2));
