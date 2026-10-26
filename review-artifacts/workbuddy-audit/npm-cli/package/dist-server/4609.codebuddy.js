"use strict";exports.ids=["4609"],exports.modules={99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

`;if(t+=`Usage: ${e.usage}
`,e.description){if(t+=`
Description:
`,"string"==typeof e.description)for(let i of e.description.split(`
`))t+=i?`  ${i}
`:`
`;else if(e.description.length>0)for(let i of e.description)t+=i?`  ${i}
`:`
`}if(e.options&&e.options.length>0)for(let i of(t+=`
Options:
`,e.options))t+=`  ${i}
`;if(e.examples&&e.examples.length>0)for(let i of(t+=`
Examples:
`,e.examples))t+=`  ${i}
`;if(e.notes&&e.notes.length>0)for(let i of(t+=`
Notes:
`,e.notes))t+=`  ${i}
`;return{stdout:t,stderr:"",exitCode:0}}function o(e){return e.includes("--help")}function r(e,t){return{stdout:"",stderr:t.startsWith("--")?`${e}: unrecognized option '${t}'
`:`${e}: invalid option -- '${t.replace(/^-/,"")}'
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},99244(e,t,i){i.d(t,{a:()=>x});var n=i(98995),l=i(99223);function x(e,t,i){let n=new Map,a=new Map;for(let[e,t]of Object.entries(i)){let i={name:e,type:t.type};t.short&&n.set(t.short,i),t.long&&a.set(t.long,i)}let f=Object.create(null);for(let[e,t]of Object.entries(i))void 0!==t.default?f[e]=t.default:"boolean"===t.type&&(f[e]=!1);let d=[],u=!1;for(let i=0;i<t.length;i++){let p=t[i];if(u||!p.startsWith("-")||"-"===p){d.push(p);continue}if("--"===p){u=!0;continue}if(p.startsWith("--")){let n=p.indexOf("="),d,u;-1!==n?(d=p.slice(2,n),u=p.slice(n+1)):d=p.slice(2);let c=a.get(d);if(!c)return{ok:!1,error:(0,l.c)(e,p)};let{name:g,type:h}=c;if("boolean"===h)f[g]=!0;else{if(void 0===u){if(i+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${d}' requires an argument
`,exitCode:1}};u=t[++i]}f[g]="number"===h?parseInt(u,10):u}}else{let a=p.slice(1);for(let d=0;d<a.length;d++){let u=a[d],p=n.get(u);if(!p)return{ok:!1,error:(0,l.c)(e,`-${u}`)};let{name:c,type:g}=p;if("boolean"===g)f[c]=!0;else{let n;if(d+1<a.length)n=a.slice(d+1);else{if(!(i+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${u}'
`,exitCode:1}};n=t[++i]}f[c]="number"===g?parseInt(n,10):n;break}}}}return{ok:!0,result:{flags:f,positional:d}}}(0,n.createRequire)(__filename)},31505(e,t,i){i.d(t,{a:()=>c,b:()=>g});var n=i(98995),l=i(29486),a=i(99244),f=i(99223),d=i(97291);(0,n.createRequire)(__filename);var u={name:"diff",summary:"compare files line by line",usage:"diff [OPTION]... FILE1 FILE2",options:["-u, --unified     output unified diff format (default)","-q, --brief       report only whether files differ","-s, --report-identical-files  report when files are the same","-i, --ignore-case  ignore case differences","    --help        display this help and exit"]},p={unified:{short:"u",long:"unified",type:"boolean"},brief:{short:"q",long:"brief",type:"boolean"},reportSame:{short:"s",long:"report-identical-files",type:"boolean"},ignoreCase:{short:"i",long:"ignore-case",type:"boolean"}},c={name:"diff",async execute(e,t){if((0,f.b)(e))return(0,f.a)(u);let i=(0,a.a)("diff",e,p);if(!i.ok)return i.error;let n=i.result.flags.brief,c=i.result.flags.reportSame,g=i.result.flags.ignoreCase,h=i.result.positional;if(i.result.flags.unified,h.length<2)return{stdout:"",stderr:`diff: missing operand
`,exitCode:2};let m,b,[y,$]=h;try{m="-"===y?(0,l.d)(t.stdin):await t.fs.readFile(t.fs.resolvePath(t.cwd,y))}catch{return{stdout:"",stderr:`diff: ${y}: No such file or directory
`,exitCode:2}}try{b="-"===$?(0,l.d)(t.stdin):await t.fs.readFile(t.fs.resolvePath(t.cwd,$))}catch{return{stdout:"",stderr:`diff: ${$}: No such file or directory
`,exitCode:2}}let C=m,w=b;return g&&(C=C.toLowerCase(),w=w.toLowerCase()),C===w?c?{stdout:`Files ${y} and ${$} are identical
`,stderr:"",exitCode:0}:{stdout:"",stderr:"",exitCode:0}:n?{stdout:`Files ${y} and ${$} differ
`,stderr:"",exitCode:1}:{stdout:d.ss(y,$,m,b,"","",{context:3}),stderr:"",exitCode:1}}},g={name:"diff",flags:[{flag:"-u",type:"boolean"},{flag:"-q",type:"boolean"},{flag:"-s",type:"boolean"},{flag:"-i",type:"boolean"}],needsArgs:!0,minArgs:2}},4907(e,t,i){i.r(t),i.d(t,{diffCommand:()=>l.a,flagsForFuzzing:()=>l.b});var n=i(98995),l=i(31505);i(29486),i(99244),i(99223),i(7863),(0,n.createRequire)(__filename)}};