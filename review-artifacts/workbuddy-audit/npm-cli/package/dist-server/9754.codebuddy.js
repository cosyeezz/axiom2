"use strict";exports.ids=["9754"],exports.modules={5688(e,t,n){n.d(t,{a:()=>p,b:()=>c});var i=n(98995),l=n(29486),a=n(99223);(0,i.createRequire)(__filename);var u={name:"unexpand",summary:"convert spaces to tabs",usage:"unexpand [OPTION]... [FILE]...",description:"Convert blanks in each FILE to TABs, writing to standard output. If no FILE is specified, standard input is read.",options:["-t N        Use N spaces per tab (default: 8)","-t LIST     Use comma-separated list of tab stops","-a          Convert all sequences of blanks (not just leading)"],examples:["unexpand file.txt           # Convert leading spaces to tabs","unexpand -a file.txt        # Convert all space sequences","unexpand -t 4 file.txt      # Use 4-space tabs"]};function f(e){let t=e.split(",").map(e=>e.trim()),n=[];for(let e of t){let t=parseInt(e,10);if(Number.isNaN(t)||t<1)return null;n.push(t)}for(let e=1;e<n.length;e++)if(n[e]<=n[e-1])return null;return n}function C(e,t){if(1===t.length){let n=t[0];return e+(n-e%n)}for(let n of t)if(n>e)return n;if(t.length>=2){let n=t[t.length-1]-t[t.length-2],i=t[t.length-1],l=Math.floor((e-i)/n)+1;return i+l*n}return -1}function N(e,t){let{tabStops:n,allBlanks:i}=t,l="",a=0,u="",p=0,c=!0,d=()=>{if(0===u.length)return;let e=p+u.length;if(!i&&!c){l+=u,u="";return}let t=p,a="";for(;t<e;){let i=C(t,n);if(i<=e&&i>t)a+="	",t=i;else break}let x=e-t;x>0&&(a+=" ".repeat(x)),l+=a,u=""};for(let t of e)" "===t?(0===u.length&&(p=a),u+=t,a++):"	"===t?(d(),l+=t,a=C(a,n)):(d(),l+=t,a++,c=!1);return d(),l}function k(e,t){if(""===e)return"";let n=e.split(`
`),i=e.endsWith(`
`)&&""===n[n.length-1];return i&&n.pop(),n.map(e=>N(e,t)).join(`
`)+(i?`
`:"")}var p={name:"unexpand",execute:async(e,t)=>{if((0,a.b)(e))return(0,a.a)(u);let n={tabStops:[8],allBlanks:!1},i=[],p=0;for(;p<e.length;){let t=e[p];if("-t"===t&&p+1<e.length){let t=f(e[p+1]);if(!t)return{exitCode:1,stdout:"",stderr:`unexpand: invalid tab size: '${e[p+1]}'
`};n.tabStops=t,p+=2}else if(t.startsWith("-t")&&t.length>2){let e=f(t.slice(2));if(!e)return{exitCode:1,stdout:"",stderr:`unexpand: invalid tab size: '${t.slice(2)}'
`};n.tabStops=e,p++}else if("--tabs"===t&&p+1<e.length){let t=f(e[p+1]);if(!t)return{exitCode:1,stdout:"",stderr:`unexpand: invalid tab size: '${e[p+1]}'
`};n.tabStops=t,p+=2}else if(t.startsWith("--tabs=")){let e=f(t.slice(7));if(!e)return{exitCode:1,stdout:"",stderr:`unexpand: invalid tab size: '${t.slice(7)}'
`};n.tabStops=e,p++}else if("-a"===t||"--all"===t)n.allBlanks=!0,p++;else if("--"===t){i.push(...e.slice(p+1));break}else{if(t.startsWith("-")&&"-"!==t)return(0,a.c)("unexpand",t);i.push(t),p++}}let c="";if(0===i.length)c=k((0,l.d)(t.stdin)??"",n);else for(let e of i){let i=t.fs.resolvePath(t.cwd,e),l=await t.fs.readFile(i);if(null===l)return{exitCode:1,stdout:c,stderr:`unexpand: ${e}: No such file or directory
`};c+=k(l,n)}return{exitCode:0,stdout:c,stderr:""}}},c={name:"unexpand",flags:[{flag:"-t",type:"value",valueHint:"number"},{flag:"-a",type:"boolean"}],stdinType:"text",needsFiles:!0}},99223(e,t,n){function s(e){let t=`${e.name} - ${e.summary}

`;if(t+=`Usage: ${e.usage}
`,e.description){if(t+=`
Description:
`,"string"==typeof e.description)for(let n of e.description.split(`
`))t+=n?`  ${n}
`:`
`;else if(e.description.length>0)for(let n of e.description)t+=n?`  ${n}
`:`
`}if(e.options&&e.options.length>0)for(let n of(t+=`
Options:
`,e.options))t+=`  ${n}
`;if(e.examples&&e.examples.length>0)for(let n of(t+=`
Examples:
`,e.examples))t+=`  ${n}
`;if(e.notes&&e.notes.length>0)for(let n of(t+=`
Notes:
`,e.notes))t+=`  ${n}
`;return{stdout:t,stderr:"",exitCode:0}}function o(e){return e.includes("--help")}function r(e,t){return{stdout:"",stderr:t.startsWith("--")?`${e}: unrecognized option '${t}'
`:`${e}: invalid option -- '${t.replace(/^-/,"")}'
`,exitCode:1}}n.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},48241(e,t,n){n.r(t),n.d(t,{flagsForFuzzing:()=>l.b,unexpand:()=>l.a});var i=n(98995),l=n(5688);n(29486),n(99223),n(7863),(0,i.createRequire)(__filename)}};