"use strict";exports.ids=["9029"],exports.modules={57731(t,n,l){l.d(n,{a:()=>w,b:()=>$});var i=l(98995),f=l(52286),p=l(20869),c=l(29486),d=l(74948),g=l(99244),u=l(99223);(0,i.createRequire)(__filename);var m={name:"tr",summary:"translate or delete characters",usage:"tr [OPTION]... SET1 [SET2]",options:["-c, -C, --complement   use the complement of SET1","-d, --delete           delete characters in SET1","-s, --squeeze-repeats  squeeze repeated characters","    --help             display this help and exit"],description:`SET syntax:
  a-z         character range
  [:alnum:]   all letters and digits
  [:alpha:]   all letters
  [:digit:]   all digits
  [:lower:]   all lowercase letters
  [:upper:]   all uppercase letters
  [:space:]   all whitespace
  [:blank:]   horizontal whitespace
  [:punct:]   all punctuation
  [:print:]   all printable characters
  [:graph:]   all printable characters except space
  [:cntrl:]   all control characters
  [:xdigit:]  all hexadecimal digits
  \\n, \\t, \\r  escape sequences`},y=new Map([["[:alnum:]","ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"],["[:alpha:]","ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"],["[:blank:]"," 	"],["[:cntrl:]",Array.from({length:32},(t,n)=>String.fromCharCode(n)).join("").concat("")],["[:digit:]","0123456789"],["[:graph:]",Array.from({length:94},(t,n)=>String.fromCharCode(33+n)).join("")],["[:lower:]","abcdefghijklmnopqrstuvwxyz"],["[:print:]",Array.from({length:95},(t,n)=>String.fromCharCode(32+n)).join("")],["[:punct:]","!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"],["[:space:]",` 	
\r\f\v`],["[:upper:]","ABCDEFGHIJKLMNOPQRSTUVWXYZ"],["[:xdigit:]","0123456789ABCDEFabcdef"]]);function F(t,n,l,i){let f="",c=0,a=t=>{if(t.length>n-f.length)throw new p.l(`tr: expanded SET exceeds string length limit (${n})`,"string_length");f+=t},h=(t=1)=>{if(t>l-i.iterations)throw new p.l(`tr: SET expansion iteration limit exceeded (${l})`,"iterations");i.iterations+=t};for(;c<t.length;){if(h(),"["===t[c]&&":"===t[c+1]){let n=!1;for(let[l,i]of y)if(t.slice(c).startsWith(l)){a(i),c+=l.length,n=!0;break}if(n)continue}if("\\"===t[c]&&c+1<t.length){let n=t[c+1];a("n"===n?`
`:"t"===n?"	":"r"===n?"\r":n),c+=2;continue}if(c+2<t.length&&"-"===t[c+1]){let l=t.charCodeAt(c),i=t.charCodeAt(c+2),d=i>=l?i-l+1:0;if(h(d),d>n-f.length)throw new p.l(`tr: expanded SET exceeds string length limit (${n})`,"string_length");for(let t=l;t<=i;t++)f+=String.fromCharCode(t);c+=3;continue}a(t[c]),c++}return f}var b={complement:{short:"c",long:"complement",type:"boolean"},complementUpper:{short:"C",type:"boolean"},delete:{short:"d",long:"delete",type:"boolean"},squeeze:{short:"s",long:"squeeze-repeats",type:"boolean"}},w={name:"tr",async execute(t,n){if((0,u.b)(t))return(0,u.a)(m);let l=(0,g.a)("tr",t,b);if(!l.ok)return l.error;let i=l.result.flags.complement||l.result.flags.complementUpper,y=l.result.flags.delete,w=l.result.flags.squeeze,$=l.result.positional;if($.length<1)return{stdout:"",stderr:`tr: missing operand
`,exitCode:1};if(!y&&!w&&$.length<2)return{stdout:"",stderr:`tr: missing operand after SET1
`,exitCode:1};let S,z,q=Math.min(n.limits.maxInputBytes,n.limits.maxStringLength),_=n.limits.maxLoopIterations,E=n.limits.maxArrayElements,T=Math.min(n.limits.maxOutputSize,n.limits.maxStringLength);try{let t={iterations:0};S=F($[0],q,_,t),z=$.length>1?F($[1],q,_,t):""}catch(t){return(0,f.a)(t),{stdout:"",stderr:`${(0,d.a)(t.message)}
`,exitCode:1}}if(n.stdin.length>q)throw new p.l(`tr: input size limit exceeded (${q} bytes)`,"string_length");let k=(0,c.d)(n.stdin);if(S.length>E||z.length>E)throw new p.l(`tr: array element limit exceeded (${E})`,"array_elements");let v=new Set(S),A=new Set(z),C=t=>{let n=v.has(t);return i?!n:n},O="",j=0,x=t=>{let n=(0,c.a)(t);if(n>T-j)throw new p.l(`tr: output size limit exceeded (${T} bytes)`,"output_size");O+=t,j+=n};if(y)for(let t of k)C(t)||x(t);else if(w&&1===$.length){let t="";for(let n of k)C(n)&&n===t||(x(n),t=n)}else{let t="",s=n=>{w&&A.has(n)&&n===t||(x(n),t=n)};if(i){let t=z.length>0?z[z.length-1]:"";for(let n of k)s(v.has(n)?n:t)}else{let t=new Map;for(let n=0;n<S.length;n++){let l=n<z.length?z[n]:z[z.length-1];t.set(S[n],l)}for(let n of k)s(t.get(n)??n)}}return{stdout:O,stderr:"",exitCode:0}}},$={name:"tr",flags:[{flag:"-c",type:"boolean"},{flag:"-C",type:"boolean"},{flag:"-d",type:"boolean"},{flag:"-s",type:"boolean"}],stdinType:"text",needsArgs:!0}},52286(t,n,l){l.d(n,{a:()=>e});var i=l(98995),f=l(8497),p=l(20869);function e(t){if(t instanceof p.l||t instanceof p.m||t instanceof f.a)throw t}(0,i.createRequire)(__filename)},99223(t,n,l){function s(t){let n=`${t.name} - ${t.summary}

`;if(n+=`Usage: ${t.usage}
`,t.description){if(n+=`
Description:
`,"string"==typeof t.description)for(let l of t.description.split(`
`))n+=l?`  ${l}
`:`
`;else if(t.description.length>0)for(let l of t.description)n+=l?`  ${l}
`:`
`}if(t.options&&t.options.length>0)for(let l of(n+=`
Options:
`,t.options))n+=`  ${l}
`;if(t.examples&&t.examples.length>0)for(let l of(n+=`
Examples:
`,t.examples))n+=`  ${l}
`;if(t.notes&&t.notes.length>0)for(let l of(n+=`
Notes:
`,t.notes))n+=`  ${l}
`;return{stdout:n,stderr:"",exitCode:0}}function o(t){return t.includes("--help")}function r(t,n){return{stdout:"",stderr:n.startsWith("--")?`${t}: unrecognized option '${n}'
`:`${t}: invalid option -- '${n.replace(/^-/,"")}'
`,exitCode:1}}l.d(n,{a:()=>s,b:()=>o,c:()=>r}),(0,l(98995).createRequire)(__filename)},99244(t,n,l){l.d(n,{a:()=>x});var i=l(98995),f=l(99223);function x(t,n,l){let i=new Map,p=new Map;for(let[t,n]of Object.entries(l)){let l={name:t,type:n.type};n.short&&i.set(n.short,l),n.long&&p.set(n.long,l)}let c=Object.create(null);for(let[t,n]of Object.entries(l))void 0!==n.default?c[t]=n.default:"boolean"===n.type&&(c[t]=!1);let d=[],g=!1;for(let l=0;l<n.length;l++){let u=n[l];if(g||!u.startsWith("-")||"-"===u){d.push(u);continue}if("--"===u){g=!0;continue}if(u.startsWith("--")){let i=u.indexOf("="),d,g;-1!==i?(d=u.slice(2,i),g=u.slice(i+1)):d=u.slice(2);let m=p.get(d);if(!m)return{ok:!1,error:(0,f.c)(t,u)};let{name:y,type:b}=m;if("boolean"===b)c[y]=!0;else{if(void 0===g){if(l+1>=n.length)return{ok:!1,error:{stdout:"",stderr:`${t}: option '--${d}' requires an argument
`,exitCode:1}};g=n[++l]}c[y]="number"===b?parseInt(g,10):g}}else{let p=u.slice(1);for(let d=0;d<p.length;d++){let g=p[d],u=i.get(g);if(!u)return{ok:!1,error:(0,f.c)(t,`-${g}`)};let{name:m,type:y}=u;if("boolean"===y)c[m]=!0;else{let i;if(d+1<p.length)i=p.slice(d+1);else{if(!(l+1<n.length))return{ok:!1,error:{stdout:"",stderr:`${t}: option requires an argument -- '${g}'
`,exitCode:1}};i=n[++l]}c[m]="number"===y?parseInt(i,10):i;break}}}}return{ok:!0,result:{flags:c,positional:d}}}(0,i.createRequire)(__filename)},18804(t,n,l){l.r(n),l.d(n,{flagsForFuzzing:()=>f.b,trCommand:()=>f.a});var i=l(98995),f=l(57731);l(52286),l(8497),l(20869),l(29486),l(74948),l(99244),l(99223),l(7863),(0,i.createRequire)(__filename)}};