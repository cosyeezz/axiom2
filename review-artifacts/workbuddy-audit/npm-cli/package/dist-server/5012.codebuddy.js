"use strict";exports.ids=["5012"],exports.modules={91618(e,t,i){i.d(t,{a:()=>u,b:()=>c});var n=i(98995),a=i(29486),f=i(99223);(0,n.createRequire)(__filename);var d={name:"rev",summary:"reverse lines characterwise",usage:"rev [file ...]",description:"Copies the specified files to standard output, reversing the order of characters in every line. If no files are specified, standard input is read.",examples:["echo 'hello' | rev     # Output: olleh","rev file.txt           # Reverse each line in file"]};function p(e){return Array.from(e).reverse().join("")}var u={name:"rev",execute:async(e,t)=>{if((0,f.b)(e))return(0,f.a)(d);let i=[];for(let t of e)if("--"===t){let n=e.indexOf(t);i.push(...e.slice(n+1));break}else{if(t.startsWith("-")&&"-"!==t)return(0,f.c)("rev",t);i.push(t)}let n="",l=e=>{let t=e.split(`
`),i=e.endsWith(`
`)&&""===t[t.length-1];return i&&t.pop(),t.map(p).join(`
`)+(i?`
`:"")};if(0===i.length)n=l((0,a.d)(t.stdin)??"");else for(let e of i)if("-"===e)n+=l((0,a.d)(t.stdin)??"");else{let i=t.fs.resolvePath(t.cwd,e),a=await t.fs.readFile(i);if(null===a)return{exitCode:1,stdout:n,stderr:`rev: ${e}: No such file or directory
`};n+=l(a)}return{exitCode:0,stdout:n,stderr:""}}},c={name:"rev",flags:[],stdinType:"text",needsFiles:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},75519(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>a.b,rev:()=>a.a});var n=i(98995),a=i(91618);i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)}};