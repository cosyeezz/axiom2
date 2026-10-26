"use strict";exports.ids=["6370"],exports.modules={56634(e,t,n){n.d(t,{a:()=>p,b:()=>u});var i=n(98995),l=n(99244),a=n(99223);(0,i.createRequire)(__filename);var f={name:"tee",summary:"read from stdin and write to stdout and files",usage:"tee [OPTION]... [FILE]...",options:["-a, --append     append to the given FILEs, do not overwrite","    --help       display this help and exit"]},d={append:{short:"a",long:"append",type:"boolean"}},p={name:"tee",async execute(e,t){if((0,a.b)(e))return(0,a.a)(f);let n=(0,l.a)("tee",e,d);if(!n.ok)return n.error;let{append:i}=n.result.flags,p=n.result.positional,u=t.stdin,c="",g=0;for(let e of p)try{let n=t.fs.resolvePath(t.cwd,e);i?await t.fs.appendFile(n,u,"binary"):await t.fs.writeFile(n,u,"binary")}catch{c+=`tee: ${e}: No such file or directory
`,g=1}return{stdout:u,stderr:c,exitCode:g,stdoutEncoding:"binary"}}},u={name:"tee",flags:[{flag:"-a",type:"boolean"}],stdinType:"text",needsArgs:!0}},99223(e,t,n){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}n.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},99244(e,t,n){n.d(t,{a:()=>x});var i=n(98995),l=n(99223);function x(e,t,n){let i=new Map,a=new Map;for(let[e,t]of Object.entries(n)){let n={name:e,type:t.type};t.short&&i.set(t.short,n),t.long&&a.set(t.long,n)}let f=Object.create(null);for(let[e,t]of Object.entries(n))void 0!==t.default?f[e]=t.default:"boolean"===t.type&&(f[e]=!1);let d=[],p=!1;for(let n=0;n<t.length;n++){let u=t[n];if(p||!u.startsWith("-")||"-"===u){d.push(u);continue}if("--"===u){p=!0;continue}if(u.startsWith("--")){let i=u.indexOf("="),d,p;-1!==i?(d=u.slice(2,i),p=u.slice(i+1)):d=u.slice(2);let c=a.get(d);if(!c)return{ok:!1,error:(0,l.c)(e,u)};let{name:g,type:m}=c;if("boolean"===m)f[g]=!0;else{if(void 0===p){if(n+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${d}' requires an argument
`,exitCode:1}};p=t[++n]}f[g]="number"===m?parseInt(p,10):p}}else{let a=u.slice(1);for(let d=0;d<a.length;d++){let p=a[d],u=i.get(p);if(!u)return{ok:!1,error:(0,l.c)(e,`-${p}`)};let{name:c,type:g}=u;if("boolean"===g)f[c]=!0;else{let i;if(d+1<a.length)i=a.slice(d+1);else{if(!(n+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${p}'
`,exitCode:1}};i=t[++n]}f[c]="number"===g?parseInt(i,10):i;break}}}}return{ok:!0,result:{flags:f,positional:d}}}(0,i.createRequire)(__filename)},10265(e,t,n){n.r(t),n.d(t,{flagsForFuzzing:()=>l.b,teeCommand:()=>l.a});var i=n(98995),l=n(56634);n(29486),n(99244),n(99223),n(7863),(0,i.createRequire)(__filename)}};