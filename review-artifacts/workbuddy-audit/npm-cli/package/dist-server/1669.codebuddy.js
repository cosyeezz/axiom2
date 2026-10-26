"use strict";exports.ids=["1669"],exports.modules={99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},31902(e,t,i){i.d(t,{a:()=>p,b:()=>f});var n=i(98995),a=i(99223);(0,n.createRequire)(__filename);var l={name:"history",summary:"display command history",usage:"history [n]",options:["-c      clear the history list","    --help display this help and exit"]},d="BASH_HISTORY",p={name:"history",async execute(e,t){if((0,a.b)(e))return(0,a.a)(l);let i=t.env.get(d)||"[]",n;try{n=JSON.parse(i)}catch{n=[]}if("-c"===e[0])return t.env.set(d,"[]"),{stdout:"",stderr:"",exitCode:0};let p=n.length;e[0]&&/^\d+$/.test(e[0])&&(p=Math.min(parseInt(e[0],10),n.length));let f=n.length-p,c="";for(let e=f;e<n.length;e++){let t=(e+1).toString().padStart(5," ");c+=`${t}  ${n[e]}
`}return{stdout:c,stderr:"",exitCode:0}}},f={name:"history",flags:[{flag:"-c",type:"boolean"}]}},12356(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>a.b,historyCommand:()=>a.a});var n=i(98995),a=i(31902);i(99223),i(7863),(0,n.createRequire)(__filename)}};