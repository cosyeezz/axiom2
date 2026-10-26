"use strict";exports.ids=["2313"],exports.modules={25974(e,t,i){i.d(t,{a:()=>f,b:()=>m});var n=i(98995),l=i(20869),a=i(29486),u=i(99223);(0,n.createRequire)(__filename);var d={name:"nl",summary:"number lines of files",usage:"nl [OPTION]... [FILE]...",description:"Write each FILE to standard output, with line numbers added. If no FILE is specified, standard input is read.",options:["-b STYLE     Body numbering style: a (all), t (non-empty), n (none)","-n FORMAT    Number format: ln (left), rn (right), rz (right zeros)","-w WIDTH     Number width (default: 6)","-s SEP       Separator after number (default: TAB)","-v START     Starting line number (default: 1)","-i INCR      Line number increment (default: 1)"],examples:["nl file.txt              # Number non-empty lines","nl -ba file.txt          # Number all lines","nl -n rz -w 3 file.txt   # Right-justified with zeros","nl -s ': ' file.txt      # Use ': ' as separator"]};function $(e,t,i){let n=String(e);switch(t){case"ln":return n.padEnd(i);case"rn":return n.padStart(i);case"rz":return n.padStart(i,"0");default:return t}}function S(e,t){switch(t){case"a":return!0;case"t":return e.trim().length>0;case"n":return!1;default:return t}}function w(e,t,i,n){if(""===e)return{output:"",nextNumber:i};let u=e.split(`
`),d=[],f=0,m=i,p=e.endsWith(`
`)&&""===u[u.length-1];for(let e of(p&&u.pop(),u)){let i=+(d.length>0),u=(0,a.a)(t.separator)+(0,a.a)(e);if(S(e,t.bodyStyle)){let a=Math.max(String(m).length,t.width)+u+i;if(a>n-f)throw new l.l(`nl: output size limit exceeded (${n} bytes)`,"output_size");let p=`${$(m,t.numberFormat,t.width)}${t.separator}${e}`;d.push(p),f+=a,m+=t.increment}else{let a=t.width+u+i;if(a>n-f)throw new l.l(`nl: output size limit exceeded (${n} bytes)`,"output_size");let m=`${" ".repeat(t.width)}${t.separator}${e}`;d.push(m),f+=a}}if(p&&f+1>n)throw new l.l(`nl: output size limit exceeded (${n} bytes)`,"output_size");return{output:d.join(`
`)+(p?`
`:""),nextNumber:m}}var f={name:"nl",execute:async(e,t)=>{if((0,u.b)(e))return(0,u.a)(d);let i={bodyStyle:"t",numberFormat:"rn",width:6,separator:"	",startNumber:1,increment:1},n=[],l=Math.min(t.limits.maxStringLength,t.limits.maxOutputSize),f=0;for(;f<e.length;){let t=e[f];if("-b"===t&&f+1<e.length){let t=e[f+1];if("a"!==t&&"t"!==t&&"n"!==t)return{exitCode:1,stdout:"",stderr:`nl: invalid body numbering style: '${t}'
`};i.bodyStyle=t,f+=2}else if(t.startsWith("-b")){let e=t.slice(2);if("a"!==e&&"t"!==e&&"n"!==e)return{exitCode:1,stdout:"",stderr:`nl: invalid body numbering style: '${e}'
`};i.bodyStyle=e,f++}else if("-n"===t&&f+1<e.length){let t=e[f+1];if("ln"!==t&&"rn"!==t&&"rz"!==t)return{exitCode:1,stdout:"",stderr:`nl: invalid line numbering format: '${t}'
`};i.numberFormat=t,f+=2}else if(t.startsWith("-n")){let e=t.slice(2);if("ln"!==e&&"rn"!==e&&"rz"!==e)return{exitCode:1,stdout:"",stderr:`nl: invalid line numbering format: '${e}'
`};i.numberFormat=e,f++}else if("-w"===t&&f+1<e.length){let t=/^\d+$/.test(e[f+1])?Number(e[f+1]):NaN;if(!Number.isSafeInteger(t)||t<1||t>l)return{exitCode:1,stdout:"",stderr:`nl: invalid line number field width: '${e[f+1]}'
`};i.width=t,f+=2}else if(t.startsWith("-w")){let e=/^\d+$/.test(t.slice(2))?Number(t.slice(2)):NaN;if(!Number.isSafeInteger(e)||e<1||e>l)return{exitCode:1,stdout:"",stderr:`nl: invalid line number field width: '${t.slice(2)}'
`};i.width=e,f++}else if("-s"===t&&f+1<e.length)i.separator=e[f+1],f+=2;else if(t.startsWith("-s"))i.separator=t.slice(2),f++;else if("-v"===t&&f+1<e.length){let t=parseInt(e[f+1],10);if(Number.isNaN(t))return{exitCode:1,stdout:"",stderr:`nl: invalid starting line number: '${e[f+1]}'
`};i.startNumber=t,f+=2}else if(t.startsWith("-v")){let e=parseInt(t.slice(2),10);if(Number.isNaN(e))return{exitCode:1,stdout:"",stderr:`nl: invalid starting line number: '${t.slice(2)}'
`};i.startNumber=e,f++}else if("-i"===t&&f+1<e.length){let t=parseInt(e[f+1],10);if(Number.isNaN(t))return{exitCode:1,stdout:"",stderr:`nl: invalid line number increment: '${e[f+1]}'
`};i.increment=t,f+=2}else if(t.startsWith("-i")){let e=parseInt(t.slice(2),10);if(Number.isNaN(e))return{exitCode:1,stdout:"",stderr:`nl: invalid line number increment: '${t.slice(2)}'
`};i.increment=e,f++}else if("--"===t){n.push(...e.slice(f+1));break}else{if(t.startsWith("-")&&"-"!==t)return(0,u.c)("nl",t);n.push(t),f++}}let m="",p=i.startNumber;if(0===n.length)m=w((0,a.d)(t.stdin)??"",i,p,l).output;else for(let e of n){let n=t.fs.resolvePath(t.cwd,e),u=await t.fs.readFile(n);if(null===u)return{exitCode:1,stdout:m,stderr:`nl: ${e}: No such file or directory
`};let d=w(u,i,p,l-(0,a.a)(m));m+=d.output,p=d.nextNumber}return{exitCode:0,stdout:m,stderr:""}}},m={name:"nl",flags:[{flag:"-b",type:"value",valueHint:"string"},{flag:"-n",type:"value",valueHint:"string"},{flag:"-w",type:"value",valueHint:"number"},{flag:"-s",type:"value",valueHint:"string"},{flag:"-v",type:"value",valueHint:"number"},{flag:"-i",type:"value",valueHint:"number"}],stdinType:"text",needsFiles:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},41200(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>l.b,nl:()=>l.a});var n=i(98995),l=i(25974);i(20869),i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)}};