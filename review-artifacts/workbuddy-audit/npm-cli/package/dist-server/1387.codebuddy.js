"use strict";exports.ids=["1387"],exports.modules={72070(t,i,n){n.r(i),n.d(i,{awkCommand2:()=>f.a,flagsForFuzzing:()=>f.b});var a=n(98995),f=n(60217);n(4692),n(65775),n(49824),n(52286),n(8497),n(83918),n(97616),n(20869),n(29486),n(99223),n(7863),(0,a.createRequire)(__filename)},52286(t,i,n){n.d(i,{a:()=>e});var a=n(98995),f=n(8497),l=n(20869);function e(t){if(t instanceof l.l||t instanceof l.m||t instanceof f.a)throw t}(0,a.createRequire)(__filename)},99223(t,i,n){function s(t){let i=`${t.name} - ${t.summary}

`;if(i+=`Usage: ${t.usage}
`,t.description){if(i+=`
Description:
`,"string"==typeof t.description)for(let n of t.description.split(`
`))i+=n?`  ${n}
`:`
`;else if(t.description.length>0)for(let n of t.description)i+=n?`  ${n}
`:`
`}if(t.options&&t.options.length>0)for(let n of(i+=`
Options:
`,t.options))i+=`  ${n}
`;if(t.examples&&t.examples.length>0)for(let n of(i+=`
Examples:
`,t.examples))i+=`  ${n}
`;if(t.notes&&t.notes.length>0)for(let n of(i+=`
Notes:
`,t.notes))i+=`  ${n}
`;return{stdout:i,stderr:"",exitCode:0}}function o(t){return t.includes("--help")}function r(t,i){return{stdout:"",stderr:i.startsWith("--")?`${t}: unrecognized option '${i}'
`:`${t}: invalid option -- '${i.replace(/^-/,"")}'
`,exitCode:1}}n.d(i,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)}};