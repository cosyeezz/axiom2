"use strict";exports.ids=["7170"],exports.modules={26833(e,t,i){i.d(t,{a:()=>d,b:()=>p});var l=i(98995),n=i(99244),a=i(99223);(0,l.createRequire)(__filename);var u={name:"tree",summary:"list contents of directories in a tree-like format",usage:"tree [OPTION]... [DIRECTORY]...",options:["-a          include hidden files","-d          list directories only","-L LEVEL    limit depth of directory tree","-f          print full path prefix for each file","    --help  display this help and exit"]},f={showHidden:{short:"a",type:"boolean"},directoriesOnly:{short:"d",type:"boolean"},fullPath:{short:"f",type:"boolean"},maxDepth:{short:"L",type:"number"}},d={name:"tree",async execute(e,t){if((0,a.b)(e))return(0,a.a)(u);let i=(0,n.a)("tree",e,f);if(!i.ok)return i.error;let l={showHidden:i.result.flags.showHidden,directoriesOnly:i.result.flags.directoriesOnly,maxDepth:i.result.flags.maxDepth??null,fullPath:i.result.flags.fullPath},d=i.result.positional;0===d.length&&d.push(".");let p="",c="",h=0,m=0;for(let e of d){let i=await T(t,e,l,"",0);p+=i.output,c+=i.stderr,h+=i.dirCount,m+=i.fileCount}return p+=`
${h} director${1===h?"y":"ies"}`,l.directoriesOnly||(p+=`, ${m} file${1===m?"":"s"}`),{stdout:p+=`
`,stderr:c,exitCode:+!!c}}};async function T(e,t,i,l,n){let a={output:"",stderr:"",dirCount:0,fileCount:0},u=e.fs.resolvePath(e.cwd,t);try{if(!(await e.fs.stat(u)).isDirectory)return a.output=`${t}
`,a.fileCount=1,a}catch{return a.stderr=`tree: ${t}: No such file or directory
`,a}if(a.output=`${t}
`,null!==i.maxDepth&&n>=i.maxDepth)return a;try{let t=[];if(e.fs.readdirWithFileTypes)t=(await e.fs.readdirWithFileTypes(u)).map(e=>({name:e.name,isDirectory:e.isDirectory}));else{let i=await e.fs.readdir(u);for(let l=0;l<i.length;l+=100){let n=i.slice(l,l+100),a=await Promise.all(n.map(async t=>{let i="/"===u?`/${t}`:`${u}/${t}`;try{let l=await e.fs.stat(i);return{name:t,isDirectory:l.isDirectory}}catch{return null}}));t.push(...a.filter(e=>null!==e))}}let f=t.filter(e=>!(!i.showHidden&&e.name.startsWith(".")||i.directoriesOnly&&!e.isDirectory));f.sort((e,t)=>e.name.localeCompare(t.name));for(let t=0;t<f.length;t++){let d=f[t],p="/"===u?`/${d.name}`:`${u}/${d.name}`,c=t===f.length-1,h=c?"`-- ":"|-- ",m=l+(c?"    ":"|   ");if(d.isDirectory){a.dirCount++;let t=i.fullPath?p:d.name;if(a.output+=`${l+h+t}
`,null===i.maxDepth||n+1<i.maxDepth){let t=await w(e,p,i,m,n+1);a.output+=t.output,a.dirCount+=t.dirCount,a.fileCount+=t.fileCount}}else{a.fileCount++;let e=i.fullPath?p:d.name;a.output+=`${l+h+e}
`}}}catch{a.stderr=`tree: ${t}: Permission denied
`}return a}async function w(e,t,i,l,n){let a={output:"",stderr:"",dirCount:0,fileCount:0};if(null!==i.maxDepth&&n>=i.maxDepth)return a;try{let u=[];if(e.fs.readdirWithFileTypes)u=(await e.fs.readdirWithFileTypes(t)).map(e=>({name:e.name,isDirectory:e.isDirectory}));else{let i=await e.fs.readdir(t);for(let l=0;l<i.length;l+=100){let n=i.slice(l,l+100),a=await Promise.all(n.map(async i=>{let l="/"===t?`/${i}`:`${t}/${i}`;try{let t=await e.fs.stat(l);return{name:i,isDirectory:t.isDirectory}}catch{return null}}));u.push(...a.filter(e=>null!==e))}}let f=u.filter(e=>!(!i.showHidden&&e.name.startsWith(".")||i.directoriesOnly&&!e.isDirectory));f.sort((e,t)=>e.name.localeCompare(t.name));for(let u=0;u<f.length;u++){let d=f[u],p="/"===t?`/${d.name}`:`${t}/${d.name}`,c=u===f.length-1,h=c?"`-- ":"|-- ",m=l+(c?"    ":"|   ");if(d.isDirectory){a.dirCount++;let t=i.fullPath?p:d.name;a.output+=`${l+h+t}
`;let u=await w(e,p,i,m,n+1);a.output+=u.output,a.dirCount+=u.dirCount,a.fileCount+=u.fileCount}else{a.fileCount++;let e=i.fullPath?p:d.name;a.output+=`${l+h+e}
`}}}catch{}return a}var p={name:"tree",flags:[{flag:"-a",type:"boolean"},{flag:"-d",type:"boolean"},{flag:"-f",type:"boolean"},{flag:"-L",type:"value",valueHint:"number"}],needsFiles:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},99244(e,t,i){i.d(t,{a:()=>x});var l=i(98995),n=i(99223);function x(e,t,i){let l=new Map,a=new Map;for(let[e,t]of Object.entries(i)){let i={name:e,type:t.type};t.short&&l.set(t.short,i),t.long&&a.set(t.long,i)}let u=Object.create(null);for(let[e,t]of Object.entries(i))void 0!==t.default?u[e]=t.default:"boolean"===t.type&&(u[e]=!1);let f=[],d=!1;for(let i=0;i<t.length;i++){let p=t[i];if(d||!p.startsWith("-")||"-"===p){f.push(p);continue}if("--"===p){d=!0;continue}if(p.startsWith("--")){let l=p.indexOf("="),f,d;-1!==l?(f=p.slice(2,l),d=p.slice(l+1)):f=p.slice(2);let c=a.get(f);if(!c)return{ok:!1,error:(0,n.c)(e,p)};let{name:h,type:m}=c;if("boolean"===m)u[h]=!0;else{if(void 0===d){if(i+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${f}' requires an argument
`,exitCode:1}};d=t[++i]}u[h]="number"===m?parseInt(d,10):d}}else{let a=p.slice(1);for(let f=0;f<a.length;f++){let d=a[f],p=l.get(d);if(!p)return{ok:!1,error:(0,n.c)(e,`-${d}`)};let{name:c,type:h}=p;if("boolean"===h)u[c]=!0;else{let l;if(f+1<a.length)l=a.slice(f+1);else{if(!(i+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${d}'
`,exitCode:1}};l=t[++i]}u[c]="number"===h?parseInt(l,10):l;break}}}}return{ok:!0,result:{flags:u,positional:f}}}(0,l.createRequire)(__filename)},64153(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>n.b,treeCommand:()=>n.a});var l=i(98995),n=i(26833);i(94362),i(99244),i(99223),i(7863),(0,l.createRequire)(__filename)}};