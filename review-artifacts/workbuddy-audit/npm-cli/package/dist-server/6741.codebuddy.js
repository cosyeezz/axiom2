"use strict";exports.ids=["6741"],exports.modules={73276(e,t,n){n.d(t,{a:()=>p,b:()=>g});var i=n(98995),l=n(34560),a=n(29486),u=n(99244),f=n(99223);(0,i.createRequire)(__filename);var c={name:"uniq",summary:"report or omit repeated lines",usage:"uniq [OPTION]... [INPUT [OUTPUT]]",options:["-c, --count        prefix lines by the number of occurrences","-d, --repeated     only print duplicate lines","-i, --ignore-case  ignore case when comparing","-u, --unique       only print unique lines","    --help         display this help and exit"]},d={count:{short:"c",long:"count",type:"boolean"},duplicatesOnly:{short:"d",long:"repeated",type:"boolean"},uniqueOnly:{short:"u",long:"unique",type:"boolean"},ignoreCase:{short:"i",long:"ignore-case",type:"boolean"}},p={name:"uniq",async execute(e,t){if((0,f.b)(e))return(0,f.a)(c);let n=(0,u.a)("uniq",e,d);if(!n.ok)return n.error;let{count:i,duplicatesOnly:p,uniqueOnly:g,ignoreCase:m}=n.result.flags,h=n.result.positional,b=await (0,l.c)(t,h,{cmdName:"uniq"});if(!b.ok)return b.error;let $=(m?(0,a.d)(b.content):b.content).split(`
`);if($.length>0&&""===$[$.length-1]&&$.pop(),0===$.length)return{stdout:"",stderr:"",exitCode:0};let q=[],C=$[0],w=1,O=(e,t)=>m?e.toLowerCase()===t.toLowerCase():e===t;for(let e=1;e<$.length;e++)O($[e],C)?w++:(q.push({line:C,count:w}),C=$[e],w=1);q.push({line:C,count:w});let k=q;p?k=q.filter(e=>e.count>1):g&&(k=q.filter(e=>1===e.count));let _="";for(let{line:e,count:t}of k)i?_+=`${String(t).padStart(4)} ${e}
`:_+=`${e}
`;return m?{stdout:_,stderr:"",exitCode:0}:{stdout:_,stderr:"",exitCode:0,stdoutKind:"bytes",stdoutEncoding:"binary"}}},g={name:"uniq",flags:[{flag:"-c",type:"boolean"},{flag:"-d",type:"boolean"},{flag:"-u",type:"boolean"},{flag:"-i",type:"boolean"}],stdinType:"text",needsFiles:!0}},34560(e,t,n){n.d(t,{a:()=>B,b:()=>y,c:()=>F});var i=n(98995),l=n(20869),a=n(29486);function B(e,t,n){if(!Number.isSafeInteger(t)||t<0||t>e.limits.maxInputBytes)throw new l.l(`${n}: input size limit exceeded (${e.limits.maxInputBytes} bytes)`,"string_length");e.executionScope?.consumeInput(t,n)}async function y(e,t,n){let{cmdName:i,allowStdinMarker:l=!0,stopOnError:u=!1,batchSize:f=100}=n;if(0===t.length)return{files:[{filename:"",content:e.stdin}],stderr:"",exitCode:0};let c=[],d="",p=0;for(let n=0;n<t.length;n+=f){let g=t.slice(n,n+f);for(let t of(await Promise.all(g.map(async t=>{if(l&&"-"===t)return{filename:"-",content:e.stdin,error:null};try{let n=e.fs.resolvePath(e.cwd,t),i=await (0,a.g)(e.fs,n);return{filename:t,content:i,error:null}}catch{return{filename:t,content:a.f,error:`${i}: ${t}: No such file or directory
`}}}))))if(t.error){if(d+=t.error,p=1,u)return{files:c,stderr:d,exitCode:p}}else c.push({filename:t.filename,content:t.content})}return{files:c,stderr:d,exitCode:p}}async function F(e,t,n){let i=await y(e,t,{...n,stopOnError:!0});return 0!==i.exitCode?{ok:!1,error:{stdout:"",stderr:i.stderr,exitCode:i.exitCode}}:{ok:!0,content:i.files.map(e=>e.content).join("")}}(0,i.createRequire)(__filename)},99223(e,t,n){function s(e){let t=`${e.name} - ${e.summary}

`;if(t+=`Usage: ${e.usage}
`,e.description){if(t+=`
Description:
`,"string"==typeof e.description)for(let n of e.description.split(`
`))t+=n?`  ${n}
`:`
`;else if(e.description.length>0)for(let n of e.description)t+=n?`  ${n}
`:`
`}if(e.options&&e.options.length>0)for(let n of(t+=`
Options:
`,e.options))t+=`  ${n}
`;if(e.examples&&e.examples.length>0)for(let n of(t+=`
Examples:
`,e.examples))t+=`  ${n}
`;if(e.notes&&e.notes.length>0)for(let n of(t+=`
Notes:
`,e.notes))t+=`  ${n}
`;return{stdout:t,stderr:"",exitCode:0}}function o(e){return e.includes("--help")}function r(e,t){return{stdout:"",stderr:t.startsWith("--")?`${e}: unrecognized option '${t}'
`:`${e}: invalid option -- '${t.replace(/^-/,"")}'
`,exitCode:1}}n.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},99244(e,t,n){n.d(t,{a:()=>x});var i=n(98995),l=n(99223);function x(e,t,n){let i=new Map,a=new Map;for(let[e,t]of Object.entries(n)){let n={name:e,type:t.type};t.short&&i.set(t.short,n),t.long&&a.set(t.long,n)}let u=Object.create(null);for(let[e,t]of Object.entries(n))void 0!==t.default?u[e]=t.default:"boolean"===t.type&&(u[e]=!1);let f=[],c=!1;for(let n=0;n<t.length;n++){let d=t[n];if(c||!d.startsWith("-")||"-"===d){f.push(d);continue}if("--"===d){c=!0;continue}if(d.startsWith("--")){let i=d.indexOf("="),f,c;-1!==i?(f=d.slice(2,i),c=d.slice(i+1)):f=d.slice(2);let p=a.get(f);if(!p)return{ok:!1,error:(0,l.c)(e,d)};let{name:g,type:m}=p;if("boolean"===m)u[g]=!0;else{if(void 0===c){if(n+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${f}' requires an argument
`,exitCode:1}};c=t[++n]}u[g]="number"===m?parseInt(c,10):c}}else{let a=d.slice(1);for(let f=0;f<a.length;f++){let c=a[f],d=i.get(c);if(!d)return{ok:!1,error:(0,l.c)(e,`-${c}`)};let{name:p,type:g}=d;if("boolean"===g)u[p]=!0;else{let i;if(f+1<a.length)i=a.slice(f+1);else{if(!(n+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${c}'
`,exitCode:1}};i=t[++n]}u[p]="number"===g?parseInt(i,10):i;break}}}}return{ok:!0,result:{flags:u,positional:f}}}(0,i.createRequire)(__filename)},84948(e,t,n){n.r(t),n.d(t,{flagsForFuzzing:()=>l.b,uniqCommand:()=>l.a});var i=n(98995),l=n(73276);n(34560),n(94362),n(20869),n(29486),n(99244),n(99223),n(7863),(0,i.createRequire)(__filename)}};