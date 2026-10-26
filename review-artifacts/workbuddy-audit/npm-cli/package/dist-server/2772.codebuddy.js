"use strict";exports.ids=["2772"],exports.modules={98614(e,t,i){i.d(t,{a:()=>d,b:()=>f});var n=i(98995),a=i(99223);(0,n.createRequire)(__filename);var l={name:"dirname",summary:"strip last component from file name",usage:"dirname [OPTION] NAME...",options:["    --help       display this help and exit"]},d={name:"dirname",async execute(e,t){if((0,a.b)(e))return(0,a.a)(l);let i=e.filter(e=>!e.startsWith("-"));if(0===i.length)return{stdout:"",stderr:`dirname: missing operand
`,exitCode:1};let n=[];for(let e of i){let t=e.replace(/\/+$/,""),i=t.lastIndexOf("/");-1===i?n.push("."):0===i?n.push("/"):n.push(t.slice(0,i))}return{stdout:`${n.join(`
`)}
`,stderr:"",exitCode:0}}},f={name:"dirname",flags:[],needsArgs:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},60607(e,t,i){i.r(t),i.d(t,{dirnameCommand:()=>a.a,flagsForFuzzing:()=>a.b});var n=i(98995),a=i(98614);i(99223),i(7863),(0,n.createRequire)(__filename)}};