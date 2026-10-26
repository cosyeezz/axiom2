"use strict";exports.ids=["4121"],exports.modules={59947(e,t,i){i.d(t,{a:()=>p,b:()=>c});var n=i(98995),l=i(99244),a=i(99223);(0,n.createRequire)(__filename);var f={name:"which",summary:"locate a command",usage:"which [-as] program ...",options:["-a         List all instances of executables found","-s         No output, just return 0 if found, 1 if not","--help     display this help and exit"]},u={showAll:{short:"a",type:"boolean"},silent:{short:"s",type:"boolean"}},p={name:"which",async execute(e,t){if((0,a.b)(e))return(0,a.a)(f);let i=(0,l.a)("which",e,u);if(!i.ok)return i.error;let n=i.result.flags.showAll,p=i.result.flags.silent,c=i.result.positional;if(0===c.length)return{stdout:"",stderr:"",exitCode:1};let d=(t.env.get("PATH")||"/usr/bin:/bin").split(":"),h="",g=!0;for(let e of c){let i=!1;for(let l of d){if(!l)continue;let a=t.fs.resolvePath(l,e);if(await t.fs.exists(a)&&(i=!0,p||(h+=`${a}
`),!n))break}i||(g=!1)}return{stdout:h,stderr:"",exitCode:+!g}}},c={name:"which",flags:[{flag:"-a",type:"boolean"},{flag:"-s",type:"boolean"}],needsArgs:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},99244(e,t,i){i.d(t,{a:()=>x});var n=i(98995),l=i(99223);function x(e,t,i){let n=new Map,a=new Map;for(let[e,t]of Object.entries(i)){let i={name:e,type:t.type};t.short&&n.set(t.short,i),t.long&&a.set(t.long,i)}let f=Object.create(null);for(let[e,t]of Object.entries(i))void 0!==t.default?f[e]=t.default:"boolean"===t.type&&(f[e]=!1);let u=[],p=!1;for(let i=0;i<t.length;i++){let c=t[i];if(p||!c.startsWith("-")||"-"===c){u.push(c);continue}if("--"===c){p=!0;continue}if(c.startsWith("--")){let n=c.indexOf("="),u,p;-1!==n?(u=c.slice(2,n),p=c.slice(n+1)):u=c.slice(2);let d=a.get(u);if(!d)return{ok:!1,error:(0,l.c)(e,c)};let{name:h,type:g}=d;if("boolean"===g)f[h]=!0;else{if(void 0===p){if(i+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${u}' requires an argument
`,exitCode:1}};p=t[++i]}f[h]="number"===g?parseInt(p,10):p}}else{let a=c.slice(1);for(let u=0;u<a.length;u++){let p=a[u],c=n.get(p);if(!c)return{ok:!1,error:(0,l.c)(e,`-${p}`)};let{name:d,type:h}=c;if("boolean"===h)f[d]=!0;else{let n;if(u+1<a.length)n=a.slice(u+1);else{if(!(i+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${p}'
`,exitCode:1}};n=t[++i]}f[d]="number"===h?parseInt(n,10):n;break}}}}return{ok:!0,result:{flags:f,positional:u}}}(0,n.createRequire)(__filename)},87040(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>l.b,whichCommand:()=>l.a});var n=i(98995),l=i(59947);i(99244),i(99223),i(7863),(0,n.createRequire)(__filename)}};