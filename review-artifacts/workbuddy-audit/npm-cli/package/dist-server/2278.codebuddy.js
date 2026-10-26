"use strict";exports.ids=["2278"],exports.modules={49850(t,e,i){i.d(e,{a:()=>d,b:()=>m});var n=i(98995),a=i(20869),u=i(99223);(0,n.createRequire)(__filename);var f={name:"strings",summary:"print the sequences of printable characters in files",usage:"strings [OPTION]... [FILE]...",description:"For each FILE, print the printable character sequences that are at least MIN characters long. If no FILE is specified, standard input is read.",options:["-n MIN       Print sequences of at least MIN characters (default: 4)","-t FORMAT    Print offset before each string (o=octal, x=hex, d=decimal)","-a           Scan the entire file (default behavior)","-e ENCODING  Select character encoding (s=7-bit, S=8-bit)"],examples:["strings file.bin          # Extract strings (min 4 chars)","strings -n 8 file.bin     # Extract strings (min 8 chars)","strings -t x file.bin     # Show hex offset","echo 'hello' | strings    # Read from stdin"]};function N(t){return t>=32&&t<=126||9===t}function S(t,e){if(null===e)return"";switch(e){case"o":return`${t.toString(8).padStart(7," ")} `;case"x":return`${t.toString(16).padStart(7," ")} `;case"d":return`${t.toString(10).padStart(7," ")} `;default:return e}}function $(t,e,i,n=!1,u){let f=[],d=0,m=0,c="string"!=typeof t||n?t:new TextEncoder().encode(t);if(c.length>i.maxStringLength-i.inputBytes)throw new a.l(`strings: aggregate input size limit exceeded (${i.maxStringLength} bytes)`,"string_length");i.inputBytes+=c.length;let p=new TextDecoder,g=(t,e)=>"string"==typeof c?c.slice(t,e):p.decode(c.subarray(t,e)),h=t=>{if(++i.iterations>i.maxIterations)throw new a.l(`strings: iteration limit exceeded (${i.maxIterations})`,"iterations");if(i.resultCount>=i.maxArrayElements)throw new a.l(`strings: array element limit exceeded (${i.maxArrayElements})`,"array_elements");let e=t.length+1;if(e>i.maxOutputSize-i.outputBytes)throw new a.l(`strings: output size limit exceeded (${i.maxOutputSize} bytes)`,"output_size");f.push(t),i.resultCount++,i.outputBytes+=e};for(let t=0;t<c.length;t++){if((4095&t)==0&&u?.aborted)throw new a.m;if(N("string"==typeof c?255&c.charCodeAt(t):c[t])){if(0===d&&(m=t),d>=i.maxStringLength)throw new a.l(`strings: string length limit exceeded (${i.maxStringLength} bytes)`,"string_length");d++}else{if(d>=e.minLength){let i=S(m,e.offsetFormat);h(`${i}${g(m,t)}`)}d=0}}if(d>=e.minLength){let t=S(m,e.offsetFormat);h(`${t}${g(m,c.length)}`)}return f}var d={name:"strings",execute:async(t,e)=>{if((0,u.b)(t))return(0,u.a)(f);let i={minLength:4,offsetFormat:null},n=[],a=0;for(;a<t.length;){let e=t[a];if("-n"===e&&a+1<t.length){let e=Number.parseInt(t[a+1],10);if(Number.isNaN(e)||e<1)return{exitCode:1,stdout:"",stderr:`strings: invalid minimum string length: '${t[a+1]}'
`};i.minLength=e,a+=2}else if(e.match(/^-n\d+$/)){let t=Number.parseInt(e.slice(2),10);if(Number.isNaN(t)||t<1)return{exitCode:1,stdout:"",stderr:`strings: invalid minimum string length: '${e.slice(2)}'
`};i.minLength=t,a++}else if(e.match(/^-\d+$/)){let t=Number.parseInt(e.slice(1),10);if(Number.isNaN(t)||t<1)return{exitCode:1,stdout:"",stderr:`strings: invalid minimum string length: '${e.slice(1)}'
`};i.minLength=t,a++}else if("-t"===e&&a+1<t.length){let e=t[a+1];if("o"!==e&&"x"!==e&&"d"!==e)return{exitCode:1,stdout:"",stderr:`strings: invalid radix: '${e}'
`};i.offsetFormat=e,a+=2}else if(e.startsWith("-t")&&3===e.length){let t=e[2];if("o"!==t&&"x"!==t&&"d"!==t)return{exitCode:1,stdout:"",stderr:`strings: invalid radix: '${t}'
`};i.offsetFormat=t,a++}else if("-a"===e||"--all"===e||"-"===e)"-"===e&&n.push(e),a++;else if("-e"===e&&a+1<t.length){let e=t[a+1];if("s"!==e&&"S"!==e)return{exitCode:1,stdout:"",stderr:`strings: invalid encoding: '${e}'
`};a+=2}else if(e.startsWith("-e")&&3===e.length){let t=e[2];if("s"!==t&&"S"!==t)return{exitCode:1,stdout:"",stderr:`strings: invalid encoding: '${t}'
`};a++}else if("--"===e){n.push(...t.slice(a+1));break}else{if(e.startsWith("-")&&"-"!==e)return(0,u.c)("strings",e);n.push(e),a++}}let d="",m={maxArrayElements:e.limits.maxArrayElements,maxIterations:e.limits.maxLoopIterations,maxStringLength:Math.min(e.limits.maxInputBytes,e.limits.maxStringLength),maxOutputSize:Math.min(e.limits.maxOutputSize,e.limits.maxStringLength),iterations:0,inputBytes:0,resultCount:0,outputBytes:0},l=()=>e.stdin;if(0===n.length){let t=$(l(),i,m,!0,e.signal);d=t.length>0?`${t.join(`
`)}
`:""}else for(let t of n){let n;if("-"===t)n=l();else{let i=e.fs.resolvePath(e.cwd,t);try{n=await e.fs.readFileBuffer(i)}catch{return{exitCode:1,stdout:d,stderr:`strings: ${t}: No such file or directory
`}}}let a=$(n,i,m,"string"==typeof n,e.signal);a.length>0&&(d+=`${a.join(`
`)}
`)}return{exitCode:0,stdout:d,stderr:""}}},m={name:"strings",flags:[{flag:"-n",type:"value",valueHint:"number"},{flag:"-t",type:"value",valueHint:"string"},{flag:"-a",type:"boolean"},{flag:"-e",type:"value",valueHint:"string"}],stdinType:"text",needsFiles:!0}},99223(t,e,i){function s(t){let e=`${t.name} - ${t.summary}

`;if(e+=`Usage: ${t.usage}
`,t.description){if(e+=`
Description:
`,"string"==typeof t.description)for(let i of t.description.split(`
`))e+=i?`  ${i}
`:`
`;else if(t.description.length>0)for(let i of t.description)e+=i?`  ${i}
`:`
`}if(t.options&&t.options.length>0)for(let i of(e+=`
Options:
`,t.options))e+=`  ${i}
`;if(t.examples&&t.examples.length>0)for(let i of(e+=`
Examples:
`,t.examples))e+=`  ${i}
`;if(t.notes&&t.notes.length>0)for(let i of(e+=`
Notes:
`,t.notes))e+=`  ${i}
`;return{stdout:e,stderr:"",exitCode:0}}function o(t){return t.includes("--help")}function r(t,e){return{stdout:"",stderr:e.startsWith("--")?`${t}: unrecognized option '${e}'
`:`${t}: invalid option -- '${e.replace(/^-/,"")}'
`,exitCode:1}}i.d(e,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},57525(t,e,i){i.r(e),i.d(e,{flagsForFuzzing:()=>a.b,strings:()=>a.a});var n=i(98995),a=i(49850);i(20869),i(29486),i(99223),i(7863),(0,n.createRequire)(__filename)}};