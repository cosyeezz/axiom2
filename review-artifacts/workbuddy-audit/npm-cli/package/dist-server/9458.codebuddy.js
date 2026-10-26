"use strict";exports.ids=["9458"],exports.modules={11134(e,t,i){i.d(t,{a:()=>u,b:()=>f});var n=i(98995),a=i(76215),l=i(99223);function h(e){let t=e.replace(/\//g,"-"),i=new Date(t);if(!Number.isNaN(i.getTime()))return i;let n=t.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(n){let[,e,t,a]=n;if(!Number.isNaN((i=new Date(Number.parseInt(e,10),Number.parseInt(t,10)-1,Number.parseInt(a,10))).getTime()))return i}let a=t.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);if(a){let[,e,t,n,l,u,f]=a;if(!Number.isNaN((i=new Date(Number.parseInt(e,10),Number.parseInt(t,10)-1,Number.parseInt(n,10),Number.parseInt(l,10),Number.parseInt(u,10),Number.parseInt(f,10))).getTime()))return i}return null}(0,n.createRequire)(__filename);var u={name:"touch",async execute(e,t){let i=[],n=null,u=!1;for(let t=0;t<e.length;t++){let a=e[t];if("--"===a){i.push(...e.slice(t+1));break}if("-d"===a||"--date"===a){if(t+1>=e.length)return{stdout:"",stderr:`touch: option requires an argument -- 'd'
`,exitCode:1};n=e[++t]}else if(a.startsWith("--date="))n=a.slice(7);else if("-c"===a||"--no-create"===a)u=!0;else if("-a"===a||"-m"===a||"-r"===a||"-t"===a)("-r"===a||"-t"===a)&&t++;else{if(a.startsWith("--"))return(0,l.c)("touch",a);if(a.startsWith("-")&&a.length>1){let i=!1;for(let f of a.slice(1))if("c"===f)u=!0;else if("a"!==f&&"m"!==f)if("d"===f){if(t+1>=e.length)return{stdout:"",stderr:`touch: option requires an argument -- 'd'
`,exitCode:1};n=e[++t],i=!0;break}else{if("r"!==f&&"t"!==f)return(0,l.c)("touch",`-${f}`);t++,i=!0;break}if(i)continue}else i.push(a)}}if(0===i.length)return{stdout:"",stderr:`touch: missing file operand
`,exitCode:1};let f=null;if(null!==n&&null===(f=h(n)))return{stdout:"",stderr:`touch: invalid date format '${n}'
`,exitCode:1};let d="",c=0;for(let e of i)try{let i=t.fs.resolvePath(t.cwd,e);if(!await t.fs.exists(i)){if(u)continue;await t.fs.writeFile(i,"")}let n=f??new Date;await t.fs.utimes(i,n,n)}catch(t){d+=`touch: cannot touch '${e}': ${(0,a.a)(t)}
`,c=1}return{stdout:"",stderr:d,exitCode:c}}},f={name:"touch",flags:[{flag:"-c",type:"boolean"},{flag:"-a",type:"boolean"},{flag:"-m",type:"boolean"},{flag:"-d",type:"value",valueHint:"string"}],needsArgs:!0}},99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},81785(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>a.b,touchCommand:()=>a.a});var n=i(98995),a=i(11134);i(76215),i(99223),i(7863),(0,n.createRequire)(__filename)}};