"use strict";exports.ids=["3718"],exports.modules={52286(t,i,n){n.d(i,{a:()=>e});var a=n(98995),l=n(8497),f=n(20869);function e(t){if(t instanceof f.l||t instanceof f.m||t instanceof l.a)throw t}(0,a.createRequire)(__filename)},99223(t,i,n){function s(t){let i=`${t.name} - ${t.summary}

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
`,exitCode:1}}n.d(i,{a:()=>s,b:()=>o,c:()=>r}),(0,n(98995).createRequire)(__filename)},99244(t,i,n){n.d(i,{a:()=>x});var a=n(98995),l=n(99223);function x(t,i,n){let a=new Map,f=new Map;for(let[t,i]of Object.entries(n)){let n={name:t,type:i.type};i.short&&a.set(i.short,n),i.long&&f.set(i.long,n)}let u=Object.create(null);for(let[t,i]of Object.entries(n))void 0!==i.default?u[t]=i.default:"boolean"===i.type&&(u[t]=!1);let c=[],d=!1;for(let n=0;n<i.length;n++){let p=i[n];if(d||!p.startsWith("-")||"-"===p){c.push(p);continue}if("--"===p){d=!0;continue}if(p.startsWith("--")){let a=p.indexOf("="),c,d;-1!==a?(c=p.slice(2,a),d=p.slice(a+1)):c=p.slice(2);let m=f.get(c);if(!m)return{ok:!1,error:(0,l.c)(t,p)};let{name:g,type:$}=m;if("boolean"===$)u[g]=!0;else{if(void 0===d){if(n+1>=i.length)return{ok:!1,error:{stdout:"",stderr:`${t}: option '--${c}' requires an argument
`,exitCode:1}};d=i[++n]}u[g]="number"===$?parseInt(d,10):d}}else{let f=p.slice(1);for(let c=0;c<f.length;c++){let d=f[c],p=a.get(d);if(!p)return{ok:!1,error:(0,l.c)(t,`-${d}`)};let{name:m,type:g}=p;if("boolean"===g)u[m]=!0;else{let a;if(c+1<f.length)a=f.slice(c+1);else{if(!(n+1<i.length))return{ok:!1,error:{stdout:"",stderr:`${t}: option requires an argument -- '${d}'
`,exitCode:1}};a=i[++n]}u[m]="number"===g?parseInt(a,10):a;break}}}}return{ok:!0,result:{flags:u,positional:c}}}(0,a.createRequire)(__filename)},87364(t,i,n){function x(t,i){return(i?"d":"-")+[256&t?"r":"-",128&t?"w":"-",64&t?"x":"-",32&t?"r":"-",16&t?"w":"-",8&t?"x":"-",4&t?"r":"-",2&t?"w":"-",1&t?"x":"-"].join("")}n.d(i,{a:()=>x}),(0,n(98995).createRequire)(__filename)},65298(t,i,n){n.d(i,{a:()=>$,b:()=>y});var a=n(98995),l=n(87364),f=n(52286),u=n(20869),c=n(29486),d=n(99244),p=n(99223);(0,a.createRequire)(__filename);var m={name:"stat",summary:"display file or file system status",usage:"stat [OPTION]... FILE...",options:["-c FORMAT   use the specified FORMAT instead of the default","    --help  display this help and exit"]},g={format:{short:"c",type:"string"}},$={name:"stat",async execute(t,i){if((0,p.b)(t))return(0,p.a)(m);let n=(0,d.a)("stat",t,g);if(!n.ok)return n.error;let a=n.result.flags.format??null,$=n.result.positional;if(0===$.length)return{stdout:"",stderr:`stat: missing operand
`,exitCode:1};let y="",b="",_=!1,v=0,w=Math.min(i.limits.maxOutputSize,i.limits.maxStringLength),h=t=>{let i=(0,c.a)(t);if(i>w-v)throw new u.l(`stat: output size limit exceeded (${w} bytes)`,"output_size");y+=t,v+=i};for(let t of $){let n=i.fs.resolvePath(i.cwd,t);try{let f=await i.fs.stat(n);if(a){let i=f.mode.toString(8),n=(0,l.a)(f.mode,f.isDirectory),u=new Map([["%n",t],["%N",`'${t}'`],["%s",String(f.size)],["%F",f.isDirectory?"directory":"regular file"],["%a",i],["%A",n],["%u","1000"],["%U","user"],["%g","1000"],["%G","group"]]),c=a.replace(/%[nNsFaAuUgG]/g,t=>u.get(t)??t);h(`${c}
`)}else{let i=f.mode.toString(8).padStart(4,"0"),n=(0,l.a)(f.mode,f.isDirectory);h(`  File: ${t}
  Size: ${f.size}		Blocks: ${Math.ceil(f.size/512)}
Access: (${i}/${n})
Modify: ${f.mtime.toISOString()}
`)}}catch(i){(0,f.a)(i),b+=`stat: cannot stat '${t}': No such file or directory
`,_=!0}}return{stdout:y,stderr:b,exitCode:+!!_}}},y={name:"stat",flags:[{flag:"-c",type:"value",valueHint:"format"},{flag:"-L",type:"boolean"}],needsArgs:!0}},68117(t,i,n){n.r(i),n.d(i,{flagsForFuzzing:()=>l.b,statCommand:()=>l.a});var a=n(98995),l=n(65298);n(87364),n(52286),n(8497),n(20869),n(29486),n(99244),n(99223),n(7863),(0,a.createRequire)(__filename)}};