"use strict";exports.ids=["3414"],exports.modules={65007(e,t,i){i.d(t,{a:()=>p,b:()=>f});var n=i(98995),l=i(20869),a=i(29486),d=i(99223);(0,n.createRequire)(__filename);var u={name:"expand",summary:"convert tabs to spaces",usage:"expand [OPTION]... [FILE]...",description:"Convert TABs in each FILE to spaces, writing to standard output. If no FILE is specified, standard input is read.",options:["-t N        Use N spaces per tab (default: 8)","-t LIST     Use comma-separated list of tab stops","-i          Only convert leading tabs on each line"],examples:["expand file.txt             # Convert all tabs to 8 spaces","expand -t 4 file.txt        # Use 4-space tabs","expand -t 4,8,12 file.txt   # Custom tab stops"]};function c(e,t,i){let n=e.split(",").map(e=>e.trim());if(n.length>i)return null;let l=[];for(let e of n){let i=/^\d+$/.test(e)?Number(e):NaN;if(!Number.isSafeInteger(i)||i<1||i>t)return null;l.push(i)}for(let e=1;e<l.length;e++)if(l[e]<=l[e-1])return null;return l}function z(e,t){if(1===t.length){let i=t[0];return i-e%i}for(let i of t)if(i>e)return i-e;if(t.length>=2){let i=t[t.length-1]-t[t.length-2],n=t[t.length-1],l=Math.floor((e-n)/i)+1;return n+l*i-e}return 1}function y(e,t,i){let{tabStops:n,leadingOnly:d}=t,u="",p=0,f=!0,x=0;for(let t of e)if("	"===t)if(d&&!f){if(x+1>i)throw new l.l(`expand: output size limit exceeded (${i} bytes)`,"output_size");u+=t,x++,p++}else{let e=z(p,n);if(e>i-x)throw new l.l(`expand: output size limit exceeded (${i} bytes)`,"output_size");u+=" ".repeat(e),x+=e,p+=e}else{" "!==t&&"	"!==t&&(f=!1);let e=(0,a.a)(t);if(e>i-x)throw new l.l(`expand: output size limit exceeded (${i} bytes)`,"output_size");u+=t,x+=e,p++}return u}function b(e,t,i){if(""===e)return"";let n=e.split(`
`),d=e.endsWith(`
`)&&""===n[n.length-1];d&&n.pop();let u=[],p=0;for(let e of n){let n=+(u.length>0),l=y(e,t,i-p-n);p+=n+(0,a.a)(l),u.push(l)}if(d&&p+1>i)throw new l.l(`expand: output size limit exceeded (${i} bytes)`,"output_size");return u.join(`
`)+(d?`
`:"")}var p={name:"expand",execute:async(e,t)=>{if((0,d.b)(e))return(0,d.a)(u);let i={tabStops:[8],leadingOnly:!1},n=[],l=Math.min(t.limits.maxStringLength,t.limits.maxOutputSize),p=t.limits.maxArrayElements,f=0;for(;f<e.length;){let t=e[f];if("-t"===t&&f+1<e.length){let t=c(e[f+1],l,p);if(!t)return{exitCode:1,stdout:"",stderr:`expand: invalid tab size: '${e[f+1]}'
`};i.tabStops=t,f+=2}else if(t.startsWith("-t")&&t.length>2){let e=c(t.slice(2),l,p);if(!e)return{exitCode:1,stdout:"",stderr:`expand: invalid tab size: '${t.slice(2)}'
`};i.tabStops=e,f++}else if("--tabs"===t&&f+1<e.length){let t=c(e[f+1],l,p);if(!t)return{exitCode:1,stdout:"",stderr:`expand: invalid tab size: '${e[f+1]}'
`};i.tabStops=t,f+=2}else if(t.startsWith("--tabs=")){let e=c(t.slice(7),l,p);if(!e)return{exitCode:1,stdout:"",stderr:`expand: invalid tab size: '${t.slice(7)}'
`};i.tabStops=e,f++}else if("-i"===t||"--initial"===t)i.leadingOnly=!0,f++;else if("--"===t){n.push(...e.slice(f+1));break}else{if(t.startsWith("-")&&"-"!==t)return(0,d.c)("expand",t);n.push(t),f++}}let x="";if(0===n.length)x=b((0,a.d)(t.stdin)??"",i,l);else for(let e of n){let n=t.fs.resolvePath(t.cwd,e),d=await t.fs.readFile(n);if(null===d)return{exitCode:1,stdout:x,stderr:`expand: ${e}: No such file or directory
`};x+=b(d,i,l-(0,a.a)(x))}return{exitCode:0,stdout:x,stderr:""}}},f={name:"expand",flags:[{flag:"-t",type:"value",valueHint:"number"},{flag:"-i",type:"boolean"}],stdinType:"text",needsFiles:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},85989(e,t,i){i.r(t),i.d(t,{expand:()=>l.a,flagsForFuzzing:()=>l.b});var n=i(98995),l=i(65007);i(83918),i(20869),i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)}};