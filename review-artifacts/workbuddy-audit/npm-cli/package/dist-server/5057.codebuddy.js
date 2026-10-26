"use strict";exports.ids=["5057"],exports.modules={90200(e,t,i){i.r(t),i.d(t,{bashCommand:()=>a.a,flagsForFuzzing:()=>a.c,shCommand:()=>a.b,shFlagsForFuzzing:()=>a.d});var n=i(98995),a=i(62551);i(4692),i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)},62551(e,t,i){i.d(t,{a:()=>h,b:()=>f,c:()=>m,d:()=>p});var n=i(98995),a=i(4692),l=i(29486),d=i(99223);(0,n.createRequire)(__filename);var u={name:"bash",summary:"execute shell commands or scripts",usage:"bash [OPTIONS] [SCRIPT_FILE] [ARGUMENTS...]",options:["-c COMMAND  execute COMMAND string","    --help  display this help and exit"],notes:["Without -c, reads and executes commands from SCRIPT_FILE.","Arguments are passed as $1, $2, etc. to the script.",'$0 is set to the script name (or "bash" with -c).']},h={name:"bash",async execute(e,t){if((0,d.b)(e))return(0,d.a)(u);if("-c"===e[0]&&e.length>=2)return c(e[1],e[2]||"bash",e.slice(3),t);if(0===e.length){let e=(0,l.d)(t.stdin);return e.trim()?c(e,"bash",[],t):{stdout:"",stderr:"",exitCode:0}}let i=e[0],n=e.slice(1);try{let e=t.fs.resolvePath(t.cwd,i),a=await t.fs.readFile(e);return c(a,i,n,t)}catch{return{stdout:"",stderr:`bash: ${i}: No such file or directory
`,exitCode:127}}}},f={name:"sh",async execute(e,t){if((0,d.b)(e))return(0,d.a)({...u,name:"sh",summary:"execute shell commands or scripts (POSIX shell)"});if("-c"===e[0]&&e.length>=2)return c(e[1],e[2]||"sh",e.slice(3),t);if(0===e.length){let e=(0,l.d)(t.stdin);return e.trim()?c(e,"sh",[],t):{stdout:"",stderr:"",exitCode:0}}let i=e[0],n=e.slice(1);try{let e=t.fs.resolvePath(t.cwd,i),a=await t.fs.readFile(e);return c(a,i,n,t)}catch{return{stdout:"",stderr:`sh: ${i}: No such file or directory
`,exitCode:127}}}};async function c(e,t,i,n){if(!n.exec)return{stdout:"",stderr:`bash: internal error: exec function not available
`,exitCode:1};let l=(0,a.c)(n.exportedEnv||{},{0:t,"#":String(i.length),"@":i.join(" "),"*":i.join(" ")});i.forEach((e,t)=>{l[String(t+1)]=e});let d=e;if(d.startsWith("#!")){let e=d.indexOf(`
`);-1!==e&&(d=d.slice(e+1))}let u=n.execWithInheritedStdin;return u?await u(d,{env:l,cwd:n.cwd,signal:n.signal}):await n.exec(d,{env:l,cwd:n.cwd,stdin:n.stdin,stdinKind:"bytes",signal:n.signal})}var m={name:"bash",flags:[{flag:"-c",type:"value",valueHint:"string"}],stdinType:"text"},p={name:"sh",flags:[{flag:"-c",type:"value",valueHint:"string"}],stdinType:"text"}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)}};