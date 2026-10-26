"use strict";exports.ids=["1293"],exports.modules={99216(e,t,r){r.d(t,{a:()=>o,b:()=>n});var i=r(98995),s=r(72614),a=r(19506),l=r(4692),d=r(74948);(0,i.createRequire)(__filename);var o={name:"time",async execute(e,t){let r="%e %M",i=null,o=!1,n=!1,c=0;for(;c<e.length;){let t=e[c];if("-f"===t||"--format"===t){if(++c>=e.length)return{stdout:"",stderr:`time: missing argument to '-f'
`,exitCode:1};r=e[c],c++}else if("-o"===t||"--output"===t){if(++c>=e.length)return{stdout:"",stderr:`time: missing argument to '-o'
`,exitCode:1};i=e[c],c++}else if("-a"===t||"--append"===t)o=!0,c++;else if("-v"===t||"--verbose"===t)r=`Command being timed: %C
Elapsed (wall clock) time: %e seconds
Maximum resident set size (kbytes): %M`,c++;else if("-p"===t||"--portability"===t)n=!0,c++;else if("--"===t){c++;break}else if(t.startsWith("-"))c++;else break}let f=e.slice(c);if(0===f.length)return{stdout:"",stderr:"",exitCode:0};let m=(0,s.c)(),u=f.join(" "),g;try{if(!t.exec)return{stdout:"",stderr:`time: exec not available
`,exitCode:1};g=await t.exec((0,a.a)([f[0]]),{env:(0,l.a)(t.env),cwd:t.cwd,stdin:t.stdin,stdinKind:"bytes",signal:t.signal,args:f.slice(1)})}catch(e){g={stdout:"",stderr:`time: ${(0,d.a)(e.message)}
`,exitCode:127}}let p=((0,s.c)()-m)/1e3,x;if(n?x=`real ${p.toFixed(2)}
user 0.00
sys 0.00
`:(x=r.replace(/%e/g,p.toFixed(2)).replace(/%E/g,F(p)).replace(/%M/g,"0").replace(/%S/g,"0.00").replace(/%U/g,"0.00").replace(/%P/g,"0%").replace(/%C/g,u)).endsWith(`
`)||(x+=`
`),i)try{let e=t.fs.resolvePath(t.cwd,i);if(o&&await t.fs.exists(e)){let r=await t.fs.readFile(e);await t.fs.writeFile(e,r+x)}else await t.fs.writeFile(e,x)}catch(t){let e=(0,d.a)(t.message);return{stdout:g.stdout,stderr:g.stderr+`time: cannot write to '${i}': ${e}
`,exitCode:g.exitCode}}else g={...g,stderr:g.stderr+x};return g}};function F(e){let t=Math.floor(e/3600),r=Math.floor(e%3600/60),i=e%60;return t>0?`${t}:${r.toString().padStart(2,"0")}:${i.toFixed(2).padStart(5,"0")}`:`${r}:${i.toFixed(2).padStart(5,"0")}`}var n={name:"time",flags:[{flag:"-p",type:"boolean"}],needsArgs:!0}},40380(e,t,r){r.r(t),r.d(t,{flagsForFuzzing:()=>s.b,timeCommand:()=>s.a});var i=r(98995),s=r(99216);r(72614),r(19506),r(4692),r(29486),r(74948),r(7863),(0,i.createRequire)(__filename)}};