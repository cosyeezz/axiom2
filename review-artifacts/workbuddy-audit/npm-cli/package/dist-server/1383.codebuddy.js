"use strict";exports.ids=["1383"],exports.modules={76961(e,t,i){i.d(t,{a:()=>u,b:()=>m});var n=i(98995),l=i(29486),a=i(99223);(0,n.createRequire)(__filename);var f={name:"comm",summary:"compare two sorted files line by line",usage:"comm [OPTION]... FILE1 FILE2",options:["-1             suppress column 1 (lines unique to FILE1)","-2             suppress column 2 (lines unique to FILE2)","-3             suppress column 3 (lines that appear in both files)","    --help     display this help and exit"]},u={name:"comm",async execute(e,t){if((0,a.b)(e))return(0,a.a)(f);let i=!1,n=!1,u=!1,m=[];for(let t of e)if("-1"===t)i=!0;else if("-2"===t)n=!0;else if("-3"===t)u=!0;else if("-12"===t||"-21"===t)i=!0,n=!0;else if("-13"===t||"-31"===t)i=!0,u=!0;else if("-23"===t||"-32"===t)n=!0,u=!0;else if("-123"===t||"-132"===t||"-213"===t||"-231"===t||"-312"===t||"-321"===t)i=!0,n=!0,u=!0;else{if(t.startsWith("-")&&"-"!==t)return(0,a.c)("comm",t);m.push(t)}if(2!==m.length)return{stdout:"",stderr:`comm: missing operand
Try 'comm --help' for more information.
`,exitCode:1};let p=async e=>{if("-"===e)return(0,l.d)(t.stdin);try{let i=t.fs.resolvePath(t.cwd,e);return await t.fs.readFile(i)}catch{return null}},d=await p(m[0]);if(null===d)return{stdout:"",stderr:`comm: ${m[0]}: No such file or directory
`,exitCode:1};let c=await p(m[1]);if(null===c)return{stdout:"",stderr:`comm: ${m[1]}: No such file or directory
`,exitCode:1};let g=d.split(`
`),h=c.split(`
`);g.length>0&&""===g[g.length-1]&&g.pop(),h.length>0&&""===h[h.length-1]&&h.pop();let $=0,x=0,y="",b=i?"":"	",C=(i?"":"	")+(n?"":"	");for(;$<g.length||x<h.length;)$>=g.length?(n||(y+=`${b}${h[x]}
`),x++):x>=h.length||g[$]<h[x]?(i||(y+=`${g[$]}
`),$++):(g[$]>h[x]?n||(y+=`${b}${h[x]}
`):(u||(y+=`${C}${g[$]}
`),$++),x++);return{stdout:y,stderr:"",exitCode:0}}},m={name:"comm",flags:[{flag:"-1",type:"boolean"},{flag:"-2",type:"boolean"},{flag:"-3",type:"boolean"}],needsArgs:!0,minArgs:2}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},32954(e,t,i){i.r(t),i.d(t,{commCommand:()=>l.a,flagsForFuzzing:()=>l.b});var n=i(98995),l=i(76961);i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)}};