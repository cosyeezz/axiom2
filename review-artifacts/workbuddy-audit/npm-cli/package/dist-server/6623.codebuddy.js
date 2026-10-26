"use strict";exports.ids=["6623"],exports.modules={93047(e,t,i){i.d(t,{a:()=>c,b:()=>u});var n=i(98995),l=i(74948),a=i(99244),d=i(76215);(0,n.createRequire)(__filename);var f={recursive:{short:"p",long:"parents",type:"boolean"},verbose:{short:"v",long:"verbose",type:"boolean"}},c={name:"mkdir",async execute(e,t){let i=(0,a.a)("mkdir",e,f);if(!i.ok)return i.error;let n=i.result.flags.recursive,c=i.result.flags.verbose,u=i.result.positional;if(0===u.length)return{stdout:"",stderr:`mkdir: missing operand
`,exitCode:1};let p="",m="",g=0;for(let e of u)try{let i=t.fs.resolvePath(t.cwd,e);await t.fs.mkdir(i,{recursive:n}),c&&(p+=`mkdir: created directory '${e}'
`)}catch(i){let t=(0,d.a)(i);t.includes("ENOENT")||t.includes("no such file")?m+=`mkdir: cannot create directory '${e}': No such file or directory
`:t.includes("EEXIST")||t.includes("already exists")?m+=`mkdir: cannot create directory '${e}': File exists
`:m+=`mkdir: cannot create directory '${e}': ${(0,l.a)(t)}
`,g=1}return{stdout:p,stderr:m,exitCode:g}}},u={name:"mkdir",flags:[{flag:"-p",type:"boolean"},{flag:"-v",type:"boolean"}],needsArgs:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},99244(e,t,i){i.d(t,{a:()=>x});var n=i(98995),l=i(99223);function x(e,t,i){let n=new Map,a=new Map;for(let[e,t]of Object.entries(i)){let i={name:e,type:t.type};t.short&&n.set(t.short,i),t.long&&a.set(t.long,i)}let d=Object.create(null);for(let[e,t]of Object.entries(i))void 0!==t.default?d[e]=t.default:"boolean"===t.type&&(d[e]=!1);let f=[],c=!1;for(let i=0;i<t.length;i++){let u=t[i];if(c||!u.startsWith("-")||"-"===u){f.push(u);continue}if("--"===u){c=!0;continue}if(u.startsWith("--")){let n=u.indexOf("="),f,c;-1!==n?(f=u.slice(2,n),c=u.slice(n+1)):f=u.slice(2);let p=a.get(f);if(!p)return{ok:!1,error:(0,l.c)(e,u)};let{name:m,type:g}=p;if("boolean"===g)d[m]=!0;else{if(void 0===c){if(i+1>=t.length)return{ok:!1,error:{stdout:"",stderr:`${e}: option '--${f}' requires an argument
`,exitCode:1}};c=t[++i]}d[m]="number"===g?parseInt(c,10):c}}else{let a=u.slice(1);for(let f=0;f<a.length;f++){let c=a[f],u=n.get(c);if(!u)return{ok:!1,error:(0,l.c)(e,`-${c}`)};let{name:p,type:m}=u;if("boolean"===m)d[p]=!0;else{let n;if(f+1<a.length)n=a.slice(f+1);else{if(!(i+1<t.length))return{ok:!1,error:{stdout:"",stderr:`${e}: option requires an argument -- '${c}'
`,exitCode:1}};n=t[++i]}d[p]="number"===m?parseInt(n,10):n;break}}}}return{ok:!0,result:{flags:d,positional:f}}}(0,n.createRequire)(__filename)},6546(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>l.b,mkdirCommand:()=>l.a});var n=i(98995),l=i(93047);i(74948),i(99244),i(76215),i(99223),i(7863),(0,n.createRequire)(__filename)}};