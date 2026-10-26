"use strict";exports.ids=["100"],exports.modules={14430(e,t,r){r.d(t,{a:()=>s,b:()=>i}),(0,r(98995).createRequire)(__filename);var s={name:"tac",execute:async function(e,t){if(e.length>0&&"-"!==e[0]){let r=t.fs.resolvePath(t.cwd,e[0]);try{let e=(await t.fs.readFile(r)).split(`
`);""===e[e.length-1]&&e.pop();let s=e.reverse();return{stdout:s.length>0?`${s.join(`
`)}
`:"",stderr:"",exitCode:0}}catch{return{stdout:"",stderr:`tac: ${e[0]}: No such file or directory
`,exitCode:1}}}let r=t.stdin.split(`
`);""===r[r.length-1]&&r.pop();let s=r.reverse();return{stdout:s.length>0?`${s.join(`
`)}
`:"",stderr:"",exitCode:0,stdoutKind:"bytes"}}},i={name:"tac",flags:[],stdinType:"text",needsFiles:!0}},2943(e,t,r){r.r(t),r.d(t,{flagsForFuzzing:()=>i.b,tac:()=>i.a});var s=r(98995),i=r(14430);r(29486),r(7863),(0,s.createRequire)(__filename)}};