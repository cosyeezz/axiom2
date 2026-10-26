"use strict";exports.ids=["3514"],exports.modules={90581(e,t,i){i.d(t,{a:()=>c,b:()=>p});var n=i(98995),a=i(99223);(0,n.createRequire)(__filename);var l={name:"clear",summary:"clear the terminal screen",usage:"clear [OPTIONS]",options:["    --help display this help and exit"]},c={name:"clear",execute:async(e,t)=>(0,a.b)(e)?(0,a.a)(l):{stdout:"\x1b[2J\x1b[H",stderr:"",exitCode:0}},p={name:"clear",flags:[]}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},73297(e,t,i){i.r(t),i.d(t,{clearCommand:()=>a.a,flagsForFuzzing:()=>a.b});var n=i(98995),a=i(90581);i(99223),i(7863),(0,n.createRequire)(__filename)}};