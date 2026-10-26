"use strict";exports.ids=["3293"],exports.modules={96908(e,t,i){i.r(t),i.d(t,{basenameCommand:()=>a.a,flagsForFuzzing:()=>a.b});var n=i(98995),a=i(79018);i(99223),i(7863),(0,n.createRequire)(__filename)},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},79018(e,t,i){i.d(t,{a:()=>p,b:()=>f});var n=i(98995),a=i(99223);(0,n.createRequire)(__filename);var l={name:"basename",summary:"strip directory and suffix from filenames",usage:`basename NAME [SUFFIX]
basename OPTION... NAME...`,options:["-a, --multiple   support multiple arguments","-s, --suffix=SUFFIX  remove a trailing SUFFIX","    --help       display this help and exit"]},p={name:"basename",async execute(e,t){if((0,a.b)(e))return(0,a.a)(l);let i=!1,n="",p=[];for(let t=0;t<e.length;t++){let a=e[t];"-a"===a||"--multiple"===a?i=!0:"-s"===a&&t+1<e.length?(n=e[++t],i=!0):a.startsWith("--suffix=")?(n=a.slice(9),i=!0):a.startsWith("-")||p.push(a)}if(0===p.length)return{stdout:"",stderr:`basename: missing operand
`,exitCode:1};!i&&p.length>=2&&(n=p.pop()??"");let f=[];for(let e of p){let t=e.replace(/\/+$/,""),i=t.split("/").pop()||t;n&&i.endsWith(n)&&(i=i.slice(0,-n.length)),f.push(i)}return{stdout:`${f.join(`
`)}
`,stderr:"",exitCode:0}}},f={name:"basename",flags:[{flag:"-a",type:"boolean"},{flag:"-s",type:"value",valueHint:"string"}],needsArgs:!0}}};