"use strict";exports.ids=["7267"],exports.modules={17295(t,i,l){l.d(i,{a:()=>h,b:()=>y});var n=l(98995),a=l(52286),f=l(97616),p=l(20869),d=l(29486),u=l(99244),m=l(99223);(0,n.createRequire)(__filename);var g={name:"paste",summary:"merge lines of files",usage:"paste [OPTION]... [FILE]...",description:["Write lines consisting of the sequentially corresponding lines from","each FILE, separated by TABs, to standard output.","","With no FILE, or when FILE is -, read standard input."],options:["-d, --delimiters=LIST   reuse characters from LIST instead of TABs","-s, --serial            paste one file at a time instead of in parallel","    --help              display this help and exit"],examples:["paste file1 file2       Merge file1 and file2 side by side","paste -d, file1 file2   Use comma as delimiter","paste -s file1          Paste all lines of file1 on one line","paste - - < file        Paste pairs of lines from file"]},c={delimiter:{short:"d",long:"delimiters",type:"string",default:"	"},serial:{short:"s",long:"serial",type:"boolean"}},h={name:"paste",async execute(t,i){if((0,m.b)(t))return(0,m.a)(g);let l=(0,u.a)("paste",t,c);if(!l.ok)return l.error;let n=l.result.flags.delimiter,h=l.result.flags.serial,y=l.result.positional;if(y.length>i.limits.maxArrayElements)throw new p.l(`paste: file operand limit exceeded (${i.limits.maxArrayElements})`,"array_elements");if((0,d.a)(n)>i.limits.maxStringLength)throw new p.l(`paste: delimiter size limit exceeded (${i.limits.maxStringLength} bytes)`,"string_length");if(0===y.length)return{stdout:"",stderr:`usage: paste [-s] [-d delimiters] file ...
`,exitCode:1};let $=(0,d.d)(i.stdin),w=$?$.split(`
`):[""];w.length>0&&""===w[w.length-1]&&w.pop();let _=y.filter(t=>"-"===t).length,v=[],I=0,E=(0,d.a)($),L=t=>{if(t.length>i.limits.maxArrayElements-I)throw new p.l(`paste: line limit exceeded (${i.limits.maxArrayElements})`,"array_elements");I+=t.length,i.executionScope?.consumeWork(t.length,"paste lines")},k=0;for(let t of y)if("-"===t){let t=[];for(let i=k;i<w.length;i+=_)t.push(w[i]);L(t),v.push(t),k++}else{let l=i.fs.resolvePath(i.cwd,t);try{let t=await i.fs.readFile(l),n=(0,d.a)(t);if(n>i.limits.maxInputBytes-E)throw new p.l(`paste: aggregate input size limit exceeded (${i.limits.maxInputBytes} bytes)`,"string_length");E+=n,i.executionScope?.consumeInput(n,"paste");let a=t.split(`
`);a.length>0&&""===a[a.length-1]&&a.pop(),L(a),v.push(a)}catch(i){return(0,a.a)(i),{stdout:"",stderr:`paste: ${t}: No such file or directory
`,exitCode:1}}}let q=new f.d(Math.min(i.limits.maxOutputSize,i.limits.maxStringLength),"paste");if(h)for(let t of v)t&&q.append(`${b(t,n)}
`);else{let t=0;for(let i of v)t=Math.max(t,i?.length??0);for(let i=0;i<t;i++){let t=[];for(let l of v)t.push(l?.[i]??"");q.append(`${b(t,n)}
`)}}return{stdout:q.build(),stderr:"",exitCode:0}}};function b(t,i){if(0===t.length)return"";if(1===t.length)return t[0];if(0===i.length)return t.join("");let l=t[0];for(let n=1;n<t.length;n++){let a=(n-1)%i.length;l+=i[a]+t[n]}return l}var y={name:"paste",flags:[{flag:"-d",type:"value",valueHint:"delimiter"},{flag:"-s",type:"boolean"}],stdinType:"text",needsFiles:!0}},52286(t,i,l){l.d(i,{a:()=>e});var n=l(98995),a=l(8497),f=l(20869);function e(t){if(t instanceof f.l||t instanceof f.m||t instanceof a.a)throw t}(0,n.createRequire)(__filename)},99223(t,i,l){function s(t){let i=`${t.name} - ${t.summary}

`;if(i+=`Usage: ${t.usage}
`,t.description){if(i+=`
Description:
`,"string"==typeof t.description)for(let l of t.description.split(`
`))i+=l?`  ${l}
`:`
`;else if(t.description.length>0)for(let l of t.description)i+=l?`  ${l}
`:`
`}if(t.options&&t.options.length>0)for(let l of(i+=`
Options:
`,t.options))i+=`  ${l}
`;if(t.examples&&t.examples.length>0)for(let l of(i+=`
Examples:
`,t.examples))i+=`  ${l}
`;if(t.notes&&t.notes.length>0)for(let l of(i+=`
Notes:
`,t.notes))i+=`  ${l}
`;return{stdout:i,stderr:"",exitCode:0}}function o(t){return t.includes("--help")}function r(t,i){return{stdout:"",stderr:i.startsWith("--")?`${t}: unrecognized option '${i}'
`:`${t}: invalid option -- '${i.replace(/^-/,"")}'
`,exitCode:1}}l.d(i,{a:()=>s,b:()=>o,c:()=>r}),(0,l(98995).createRequire)(__filename)},99244(t,i,l){l.d(i,{a:()=>x});var n=l(98995),a=l(99223);function x(t,i,l){let n=new Map,f=new Map;for(let[t,i]of Object.entries(l)){let l={name:t,type:i.type};i.short&&n.set(i.short,l),i.long&&f.set(i.long,l)}let p=Object.create(null);for(let[t,i]of Object.entries(l))void 0!==i.default?p[t]=i.default:"boolean"===i.type&&(p[t]=!1);let d=[],u=!1;for(let l=0;l<i.length;l++){let m=i[l];if(u||!m.startsWith("-")||"-"===m){d.push(m);continue}if("--"===m){u=!0;continue}if(m.startsWith("--")){let n=m.indexOf("="),d,u;-1!==n?(d=m.slice(2,n),u=m.slice(n+1)):d=m.slice(2);let g=f.get(d);if(!g)return{ok:!1,error:(0,a.c)(t,m)};let{name:c,type:h}=g;if("boolean"===h)p[c]=!0;else{if(void 0===u){if(l+1>=i.length)return{ok:!1,error:{stdout:"",stderr:`${t}: option '--${d}' requires an argument
`,exitCode:1}};u=i[++l]}p[c]="number"===h?parseInt(u,10):u}}else{let f=m.slice(1);for(let d=0;d<f.length;d++){let u=f[d],m=n.get(u);if(!m)return{ok:!1,error:(0,a.c)(t,`-${u}`)};let{name:g,type:c}=m;if("boolean"===c)p[g]=!0;else{let n;if(d+1<f.length)n=f.slice(d+1);else{if(!(l+1<i.length))return{ok:!1,error:{stdout:"",stderr:`${t}: option requires an argument -- '${u}'
`,exitCode:1}};n=i[++l]}p[g]="number"===c?parseInt(n,10):n;break}}}}return{ok:!0,result:{flags:p,positional:d}}}(0,n.createRequire)(__filename)},81726(t,i,l){l.r(i),l.d(i,{flagsForFuzzing:()=>a.b,pasteCommand:()=>a.a});var n=l(98995),a=l(17295);l(52286),l(8497),l(97616),l(20869),l(29486),l(99244),l(99223),l(7863),(0,n.createRequire)(__filename)}};