"use strict";exports.ids=["7582"],exports.modules={30823(t,i,n){n.d(i,{a:()=>A,b:()=>F,c:()=>H,d:()=>O});var l=n(98995),a=n(52286),f=n(97616),u=n(20869),d=n(29486),p=n(99223);function A(t,i){let n=10,l=null,a=!1,f=!1,u=!1,d=[];for(let c=0;c<t.length;c++){let m=t[c];if("-n"===m&&c+1<t.length){let l=t[++c];"tail"===i&&l.startsWith("+")?(u=!0,n=parseInt(l.slice(1),10)):n=parseInt(l,10)}else if("tail"===i&&m.startsWith("-n+"))u=!0,n=parseInt(m.slice(3),10);else if(m.startsWith("-n"))n=parseInt(m.slice(2),10);else if("-c"===m&&c+1<t.length)l=parseInt(t[++c],10);else if(m.startsWith("-c"))l=parseInt(m.slice(2),10);else if(m.startsWith("--bytes="))l=parseInt(m.slice(8),10);else if(m.startsWith("--lines="))n=parseInt(m.slice(8),10);else if("-q"===m||"--quiet"===m||"--silent"===m)a=!0;else if("-v"===m||"--verbose"===m)f=!0;else if(m.match(/^-\d+$/))n=parseInt(m.slice(1),10);else{if(m.startsWith("--")||m.startsWith("-")&&"-"!==m)return{ok:!1,error:(0,p.c)(i,m)};d.push(m)}}return null!==l&&(Number.isNaN(l)||l<0)?{ok:!1,error:{stdout:"",stderr:`${i}: invalid number of bytes
`,exitCode:1}}:Number.isNaN(n)||n<0?{ok:!1,error:{stdout:"",stderr:`${i}: invalid number of lines
`,exitCode:1}}:{ok:!0,options:{lines:n,bytes:l,quiet:a,verbose:f,files:d,fromLine:u}}}async function F(t,i,n,l){let{quiet:p,verbose:c,files:m}=i;if(m.length>t.limits.maxArrayElements)throw new u.l(`${n}: file operand limit exceeded (${t.limits.maxArrayElements})`,"array_elements");if(0===m.length)return{stdout:l(t.stdin),stderr:"",exitCode:0,stdoutEncoding:"binary"};let g=Math.min(t.limits.maxOutputSize,t.limits.maxStringLength),h=new f.d(g,n),b=new f.d(g,n),y=0,x=0,$=c||!p&&m.length>1,v=0;for(let i=0;i<m.length;i++){let f=m[i];try{let i=t.fs.resolvePath(t.cwd,f);if((await t.fs.stat(i)).size>t.limits.maxInputBytes-x)throw new u.l(`${n}: aggregate input size limit exceeded (${t.limits.maxInputBytes} bytes)`,"string_length");let a=await (0,d.g)(t.fs,i);if(a.length>t.limits.maxInputBytes-x)throw new u.l(`${n}: aggregate input size limit exceeded (${t.limits.maxInputBytes} bytes)`,"string_length");x+=a.length,t.executionScope?.consumeInput(a.length,n),$&&(v>0&&h.append(`
`),h.append((0,d.e)(`==> ${f} <==
`))),h.append(l(a)),v++}catch(t){(0,a.a)(t),b.append(`${n}: ${f}: No such file or directory
`),y=1}}return{stdout:h.build(),stderr:b.build(),exitCode:y,stdoutEncoding:"binary"}}function H(t,i,n){if(null!==n)return t.slice(0,n);if(0===i)return"";let l=0,a=0,f=t.length;for(;l<f&&a<i;){let i=t.indexOf(`
`,l);if(-1===i)return t;a++,l=i+1}return l>0?t.slice(0,l):""}function O(t,i,n,l){if(null!==n)return 0===n?"":t.slice(-n);let a=t.length;if(0===a)return"";if(l){let n=0,l=1;for(;n<a&&l<i;){let i=t.indexOf(`
`,n);if(-1===i)return"";l++,n=i+1}return t.slice(n)}if(0===i)return"";let f=a-1;t[f]===`
`&&f--;let u=0;for(;f>=0&&u<i;){if(t[f]===`
`&&++u===i){f++;break}f--}return f<0&&(f=0),t.slice(f)}(0,l.createRequire)(__filename)},52286(t,i,n){n.d(i,{a:()=>e});var l=n(98995),a=n(8497),f=n(20869);function e(t){if(t instanceof f.l||t instanceof f.m||t instanceof a.a)throw t}(0,l.createRequire)(__filename)},99223(t,i,n){function s(t){let i=`${t.name} - ${t.summary}

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
`,exitCode:1}}n.d(i,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},1761(t,i,n){n.d(i,{a:()=>d,b:()=>p});var l=n(98995),a=n(30823),f=n(99223);(0,l.createRequire)(__filename);var u={name:"tail",summary:"output the last part of files",usage:"tail [OPTION]... [FILE]...",options:["-c, --bytes=NUM    print the last NUM bytes","-n, --lines=NUM    print the last NUM lines (default 10)","-n +NUM            print starting from line NUM","-q, --quiet        never print headers giving file names","-v, --verbose      always print headers giving file names","    --help         display this help and exit"]},d={name:"tail",async execute(t,i){if((0,f.b)(t))return(0,f.a)(u);let n=(0,a.a)(t,"tail");if(!n.ok)return n.error;let{lines:l,bytes:d,fromLine:p}=n.options;return(0,a.b)(i,n.options,"tail",t=>(0,a.d)(t,l,d,p??!1))}},p={name:"tail",flags:[{flag:"-n",type:"value",valueHint:"number"},{flag:"-c",type:"value",valueHint:"number"},{flag:"-q",type:"boolean"},{flag:"-v",type:"boolean"}],stdinType:"text",needsFiles:!0}},14653(t,i,n){n.r(i),n.d(i,{flagsForFuzzing:()=>a.b,tailCommand:()=>a.a});var l=n(98995),a=n(1761);n(30823),n(52286),n(8497),n(97616),n(20869),n(29486),n(99223),n(7863),(0,l.createRequire)(__filename)}};