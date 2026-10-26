"use strict";exports.ids=["1785"],exports.modules={80793(e,t,n){n.d(t,{a:()=>u,b:()=>p,c:()=>c,d:()=>m});var i=n(98995),l=n(4692),a=n(99223);(0,i.createRequire)(__filename);var f={name:"env",summary:"run a program in a modified environment",usage:"env [OPTION]... [NAME=VALUE]... [COMMAND [ARG]...]",options:["-i, --ignore-environment  start with an empty environment","-u NAME, --unset=NAME     remove NAME from the environment","    --help                display this help and exit"]},u={name:"env",async execute(e,t){let n;if((0,a.b)(e))return(0,a.a)(f);let i=!1,u=[],d=new Map,p=-1;for(let t=0;t<e.length;t++){let n=e[t];if("-i"===n||"--ignore-environment"===n)i=!0;else if("-u"===n&&t+1<e.length)u.push(e[++t]);else if(n.startsWith("-u"))u.push(n.slice(2));else if(n.startsWith("--unset="))u.push(n.slice(8));else{if(n.startsWith("--")&&"--"!==n)return(0,a.c)("env",n);if(n.startsWith("-")&&"-"!==n){for(let e of n.slice(1))if("i"!==e&&"u"!==e)return(0,a.c)("env",`-${e}`);n.includes("i")&&(i=!0)}else if(n.includes("=")&&-1===p){let e=n.indexOf("="),t=n.slice(0,e),i=n.slice(e+1);d.set(t,i)}else{p=t;break}}}if(i)n=new Map(d);else{for(let e of(n=new Map(t.env),u))n.delete(e);for(let[e,t]of d)n.set(e,t)}if(-1===p){let e=[];for(let[t,i]of n)e.push(`${t}=${i}`);return{stdout:e.join(`
`)+(e.length>0?`
`:""),stderr:"",exitCode:0}}if(!t.exec)return{stdout:"",stderr:`env: command execution not supported in this context
`,exitCode:1};let c=e.slice(p);return t.exec("command",{cwd:t.cwd,env:(0,l.a)(n),replaceEnv:!0,stdin:t.stdin,stdinKind:"bytes",signal:t.signal,args:c})}},d={name:"printenv",summary:"print all or part of environment",usage:"printenv [OPTION]... [VARIABLE]...",options:["    --help       display this help and exit"]},p={name:"printenv",async execute(e,t){if((0,a.b)(e))return(0,a.a)(d);let n=e.filter(e=>!e.startsWith("-"));if(0===n.length){let e=[];for(let[n,i]of t.env)e.push(`${n}=${i}`);return{stdout:e.join(`
`)+(e.length>0?`
`:""),stderr:"",exitCode:0}}let i=[],l=0;for(let e of n){let n=t.env.get(e);void 0!==n?i.push(n):l=1}return{stdout:i.join(`
`)+(i.length>0?`
`:""),stderr:"",exitCode:l}}},c={name:"env",flags:[{flag:"-i",type:"boolean"},{flag:"-u",type:"value",valueHint:"string"}]},m={name:"printenv",flags:[]}},99223(e,t,n){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}n.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},51232(e,t,n){n.r(t),n.d(t,{envCommand:()=>l.a,flagsForFuzzing:()=>l.c,printenvCommand:()=>l.b,printenvFlagsForFuzzing:()=>l.d});var i=n(98995),l=n(80793);n(4692),n(29486),n(99223),n(7863),(0,i.createRequire)(__filename)}};