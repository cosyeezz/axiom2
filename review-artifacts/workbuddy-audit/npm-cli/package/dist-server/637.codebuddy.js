"use strict";exports.ids=["637"],exports.modules={76465(e,t,i){i.d(t,{a:()=>d,b:()=>c});var n=i(98995),l=i(74948),a=i(99223);(0,n.createRequire)(__filename);var f={name:"ln",summary:"make links between files",usage:"ln [OPTIONS] TARGET LINK_NAME",options:["-s      create a symbolic link instead of a hard link","-f      remove existing destination files","-n      treat LINK_NAME as a normal file if it is a symbolic link to a directory","-v      print name of each linked file","    --help display this help and exit"]},d={name:"ln",async execute(e,t){if((0,a.b)(e))return(0,a.a)(f);let i=!1,n=!1,d=!1,c=0;for(;c<e.length&&e[c].startsWith("-");){let t=e[c];if("-s"===t||"--symbolic"===t)i=!0,c++;else if("-f"===t||"--force"===t)n=!0,c++;else if("-v"===t||"--verbose"===t)d=!0,c++;else if("-n"===t||"--no-dereference"===t)c++;else if(/^-[sfvn]+$/.test(t))t.includes("s")&&(i=!0),t.includes("f")&&(n=!0),t.includes("v")&&(d=!0),c++;else{if("--"!==t)return(0,a.c)("ln",t);c++;break}}let u=e.slice(c);if(u.length<2)return{stdout:"",stderr:`ln: missing file operand
`,exitCode:1};if(u.length>2)return{stdout:"",stderr:`ln: extra operand '${u[2]}'
`,exitCode:1};let m=u[0],p=u[1],g=t.fs.resolvePath(t.cwd,p);if(await t.fs.exists(g))if(!n)return{stdout:"",stderr:`ln: failed to create ${i?"symbolic ":""}link '${p}': File exists
`,exitCode:1};else try{await t.fs.rm(g,{force:!0})}catch{return{stdout:"",stderr:`ln: cannot remove '${p}': Permission denied
`,exitCode:1}}try{if(i)await t.fs.symlink(m,g);else{let e=t.fs.resolvePath(t.cwd,m);if(!await t.fs.exists(e))return{stdout:"",stderr:`ln: failed to access '${m}': No such file or directory
`,exitCode:1};await t.fs.link(e,g)}}catch(e){return e.message.includes("EPERM")?{stdout:"",stderr:`ln: '${m}': hard link not allowed for directory
`,exitCode:1}:{stdout:"",stderr:`ln: ${(0,l.a)(e.message)}
`,exitCode:1}}let x="";return d&&(x=`'${p}' -> '${m}'
`),{stdout:x,stderr:"",exitCode:0}}},c={name:"ln",flags:[{flag:"-s",type:"boolean"},{flag:"-f",type:"boolean"},{flag:"-n",type:"boolean"},{flag:"-v",type:"boolean"}],needsArgs:!0,minArgs:2}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},48652(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>l.b,lnCommand:()=>l.a});var n=i(98995),l=i(76465);i(74948),i(99223),i(7863),(0,n.createRequire)(__filename)}};