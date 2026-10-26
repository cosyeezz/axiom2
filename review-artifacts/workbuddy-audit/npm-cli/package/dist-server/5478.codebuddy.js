"use strict";exports.ids=["5478"],exports.modules={53174(e,t,n){n.d(t,{a:()=>c,b:()=>d});var i=n(98995),l=n(74948),a=n(99244),f=n(76215);(0,i.createRequire)(__filename);var u={recursive:{short:"r",long:"recursive",type:"boolean"},recursiveUpper:{short:"R",type:"boolean"},force:{short:"f",long:"force",type:"boolean"},verbose:{short:"v",long:"verbose",type:"boolean"}},c={name:"rm",async execute(e,t){let n=(0,a.a)("rm",e,u);if(!n.ok)return n.error;let i=n.result.flags.recursive||n.result.flags.recursiveUpper,c=n.result.flags.force,d=n.result.flags.verbose,p=n.result.positional;if(0===p.length)return c?{stdout:"",stderr:"",exitCode:0}:{stdout:"",stderr:`rm: missing operand
`,exitCode:1};let m="",g="",h=0;for(let e of p)try{let n=t.fs.resolvePath(t.cwd,e);if((await t.fs.stat(n)).isDirectory&&!i){g+=`rm: cannot remove '${e}': Is a directory
`,h=1;continue}await t.fs.rm(n,{recursive:i,force:c}),d&&(m+=`removed '${e}'
`)}catch(t){if(!c){let n=(0,f.a)(t);n.includes("ENOENT")||n.includes("no such file")?g+=`rm: cannot remove '${e}': No such file or directory
`:n.includes("ENOTEMPTY")||n.includes("not empty")?g+=`rm: cannot remove '${e}': Directory not empty
`:g+=`rm: cannot remove '${e}': ${(0,l.a)(n)}
`,h=1}}return{stdout:m,stderr:g,exitCode:h}}},d={name:"rm",flags:[{flag:"-r",type:"boolean"},{flag:"-R",type:"boolean"},{flag:"-f",type:"boolean"},{flag:"-v",type:"boolean"}],needsArgs:!0}},99223(e,t,n){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}n.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},99244(e,t,n){n.d(t,{a:()=>x});var i=n(98995),l=n(99223);function x(e,t,n){let i=new Map,a=new Map;for(let[e,t]of Object.entries(n)){let n={name:e,type:t.type};t.short&&i.set(t.short,n),t.long&&a.set(t.long,n)}let f=Object.create(null);for(let[e,t]of Object.entries(n))void 0!==t.default?f[e]=t.default:"boolean"===t.type&&(f[e]=!1);let u=[],c=!1;for(let n=0;n<t.length;n++){let d=t[n];if(c||!d.startsWith("-")||"-"===d){u.push(d);continue}if("--"===d){c=!0;continue}if(d.startsWith("--")){let i=d.indexOf("="),u,c;-1!==i?(u=d.slice(2,i),c=d.slice(i+1)):u=d.slice(2);let p=a.get(u);if(!p)return{ok:!1,error:(0,l.c)(e,d)};let{name:m,type:g}=p;if("boolean"===g)f[m]=!0;else{if(void 0===c){if(n+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${u}' requires an argument
`,exitCode:1}};c=t[++n]}f[m]="number"===g?parseInt(c,10):c}}else{let a=d.slice(1);for(let u=0;u<a.length;u++){let c=a[u],d=i.get(c);if(!d)return{ok:!1,error:(0,l.c)(e,`-${c}`)};let{name:p,type:m}=d;if("boolean"===m)f[p]=!0;else{let i;if(u+1<a.length)i=a.slice(u+1);else{if(!(n+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${c}'
`,exitCode:1}};i=t[++n]}f[p]="number"===m?parseInt(i,10):i;break}}}}return{ok:!0,result:{flags:f,positional:u}}}(0,i.createRequire)(__filename)},31397(e,t,n){n.r(t),n.d(t,{flagsForFuzzing:()=>l.b,rmCommand:()=>l.a});var i=n(98995),l=n(53174);n(74948),n(99244),n(76215),n(99223),n(7863),(0,i.createRequire)(__filename)}};