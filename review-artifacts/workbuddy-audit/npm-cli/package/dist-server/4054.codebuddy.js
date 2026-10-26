"use strict";exports.ids=["4054"],exports.modules={99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},44449(e,t,i){i.d(t,{a:()=>u,b:()=>d});var n=i(98995),l=i(29486),a=i(99223);(0,n.createRequire)(__filename);var f={name:"fold",summary:"wrap each input line to fit in specified width",usage:"fold [OPTION]... [FILE]...",description:"Wrap input lines in each FILE, writing to standard output. If no FILE is specified, standard input is read.",options:["-w WIDTH    Use WIDTH columns instead of 80","-s          Break at spaces","-b          Count bytes rather than columns"],examples:["fold -w 40 file.txt           # Wrap at 40 columns","fold -sw 40 file.txt          # Word wrap at 40 columns","echo 'long line' | fold -w 5  # Force wrap at 5"]};function y(e,t,i){return i?(0,l.a)(e):"	"===e?8-t%8:"\b"===e?-1:1}function N(e,t){if(0===e.length)return e;let{width:i,breakAtSpaces:n,countBytes:l}=t,a=[],f="",u=0,d=-1,c=0;for(let t of e){let e=y(t,u,l);u+e>i&&f.length>0?(n&&d>=0?(a.push(f.slice(0,d+1)),f=f.slice(d+1)+t,u=u-c-1+e):(a.push(f),f=t,u=e),d=-1,c=0):(f+=t,u+=e,(" "===t||"	"===t)&&(d=f.length-1,c=u-e))}return f.length>0&&a.push(f),a.join(`
`)}function m(e,t){if(""===e)return"";let i=e.split(`
`),n=e.endsWith(`
`)&&""===i[i.length-1];return n&&i.pop(),i.map(e=>N(e,t)).join(`
`)+(n?`
`:"")}var u={name:"fold",execute:async(e,t)=>{if((0,a.b)(e))return(0,a.a)(f);let i={width:80,breakAtSpaces:!1,countBytes:!1},n=[],u=0;for(;u<e.length;){let t=e[u];if("-w"===t&&u+1<e.length){let t=parseInt(e[u+1],10);if(Number.isNaN(t)||t<1)return{exitCode:1,stdout:"",stderr:`fold: invalid number of columns: '${e[u+1]}'
`};i.width=t,u+=2}else if(t.startsWith("-w")&&t.length>2){let e=parseInt(t.slice(2),10);if(Number.isNaN(e)||e<1)return{exitCode:1,stdout:"",stderr:`fold: invalid number of columns: '${t.slice(2)}'
`};i.width=e,u++}else if("-s"===t)i.breakAtSpaces=!0,u++;else if("-b"===t)i.countBytes=!0,u++;else if("-bs"===t||"-sb"===t)i.breakAtSpaces=!0,i.countBytes=!0,u++;else if(t.match(/^-[sb]+w\d+$/)){t.includes("s")&&(i.breakAtSpaces=!0),t.includes("b")&&(i.countBytes=!0);let e=t.replace(/^-[sb]+w/,""),n=parseInt(e,10);if(Number.isNaN(n)||n<1)return{exitCode:1,stdout:"",stderr:`fold: invalid number of columns: '${e}'
`};i.width=n,u++}else if(t.match(/^-[sb]+w$/)&&u+1<e.length){t.includes("s")&&(i.breakAtSpaces=!0),t.includes("b")&&(i.countBytes=!0);let n=parseInt(e[u+1],10);if(Number.isNaN(n)||n<1)return{exitCode:1,stdout:"",stderr:`fold: invalid number of columns: '${e[u+1]}'
`};i.width=n,u+=2}else if("--"===t){n.push(...e.slice(u+1));break}else if(t.startsWith("-")&&"-"!==t){let e=t.slice(1),n=!1;for(let t of e)if("s"===t)i.breakAtSpaces=!0;else if("b"===t)i.countBytes=!0;else{n=!0;break}if(n)return(0,a.c)("fold",t);u++}else n.push(t),u++}let d="";if(0===n.length)d=m((0,l.d)(t.stdin)??"",i);else for(let e of n){let n=t.fs.resolvePath(t.cwd,e),l=await t.fs.readFile(n);if(null===l)return{exitCode:1,stdout:d,stderr:`fold: ${e}: No such file or directory
`};d+=m(l,i)}return{exitCode:0,stdout:d,stderr:""}}},d={name:"fold",flags:[{flag:"-w",type:"value",valueHint:"number"},{flag:"-s",type:"boolean"},{flag:"-b",type:"boolean"}],stdinType:"text",needsFiles:!0}},84853(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>l.b,fold:()=>l.a});var n=i(98995),l=i(44449);i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)}};