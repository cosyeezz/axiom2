// Trusted judge runs outside the candidate VM, in a bounded, permission-restricted child.
const { runInNewContext } = require('node:vm');
let input='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{ input+=chunk; if(input.length>32768)process.exit(2); });
process.stdin.on('end',()=>{
 try {
  const {source,cases}=JSON.parse(input);
  const context=Object.create(null);
  runInNewContext(source,context,{timeout:100,contextCodeGeneration:{strings:false,wasm:false},microtaskMode:'afterEvaluate'});
  function plainPairs(value){
   if(!Array.isArray(value))throw Error();
   const len=Object.getOwnPropertyDescriptor(value,'length');
   if(!len||!Number.isSafeInteger(len.value)||len.value<0||len.value>100)throw Error();
   const result=[];
   for(let i=0;i<len.value;i++){
    const row=Object.getOwnPropertyDescriptor(value,String(i));
    if(!row||!('value' in row)||!Array.isArray(row.value))throw Error();
    const n=Object.getOwnPropertyDescriptor(row.value,'length');
    if(!n||n.value!==2)throw Error();
    const pair=[];
    for(let j=0;j<2;j++){const p=Object.getOwnPropertyDescriptor(row.value,String(j));if(!p||!('value'in p)||typeof p.value!=='number'||!Number.isFinite(p.value))throw Error();pair.push(p.value);}
    result.push(pair);
   }
   return result;
  }
  let passed=true;
  for(const [values,expected] of cases){
   const result=runInNewContext(`(() => { const input = ${JSON.stringify(values)}; const output = mergeIntervals(input); return [input,output]; })()`,context,{timeout:100,microtaskMode:'afterEvaluate'});
   const input=Object.getOwnPropertyDescriptor(result,'0'),output=Object.getOwnPropertyDescriptor(result,'1');
   if(!input||!output||!('value'in input)||!('value'in output))throw Error();
   if(JSON.stringify(plainPairs(input.value))!==JSON.stringify(values)||JSON.stringify(plainPairs(output.value))!==JSON.stringify(expected))passed=false;
  }
  process.stdout.write(JSON.stringify({passed}));
 }catch{process.stdout.write('{"passed":false}');}
});
