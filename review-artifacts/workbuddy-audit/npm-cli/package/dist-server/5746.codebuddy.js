"use strict";exports.ids=["5746"],exports.modules={14489(e,t,a){a.r(t),a.d(t,{aliasCommand:()=>n.a,flagsForFuzzing:()=>n.c,unaliasCommand:()=>n.b,unaliasFlagsForFuzzing:()=>n.d});var i=a(98995),n=a(90476);a(99223),a(7863),(0,i.createRequire)(__filename)},90476(e,t,a){a.d(t,{a:()=>u,b:()=>f,c:()=>m,d:()=>p});var i=a(98995),n=a(99223);(0,i.createRequire)(__filename);var l={name:"alias",summary:"define or display aliases",usage:"alias [name[=value] ...]",options:["    --help display this help and exit"]},d="BASH_ALIAS_",u={name:"alias",async execute(e,t){if((0,n.b)(e))return(0,n.a)(l);if(0===e.length){let e="";for(let[a,i]of t.env)if(a.startsWith(d)){let t=a.slice(d.length);e+=`alias ${t}='${i}'
`}return{stdout:e,stderr:"",exitCode:0}}for(let a of"--"===e[0]?e.slice(1):e){let e=a.indexOf("=");if(-1===e){let e=d+a;return t.env.get(e)?{stdout:`alias ${a}='${t.env.get(e)}'
`,stderr:"",exitCode:0}:{stdout:"",stderr:`alias: ${a}: not found
`,exitCode:1}}{let i=a.slice(0,e),n=a.slice(e+1);(n.startsWith("'")&&n.endsWith("'")||n.startsWith('"')&&n.endsWith('"'))&&(n=n.slice(1,-1)),t.env.set(d+i,n)}}return{stdout:"",stderr:"",exitCode:0}}},f={name:"unalias",async execute(e,t){if((0,n.b)(e))return(0,n.a)({name:"unalias",summary:"remove alias definitions",usage:"unalias name [name ...]",options:["-a      remove all aliases","    --help display this help and exit"]});if(0===e.length)return{stdout:"",stderr:`unalias: usage: unalias [-a] name [name ...]
`,exitCode:1};if("-a"===e[0]){for(let e of t.env.keys())e.startsWith(d)&&t.env.delete(e);return{stdout:"",stderr:"",exitCode:0}}let a="--"===e[0]?e.slice(1):e,i=!1,l="";for(let e of a){let a=d+e;t.env.get(a)?t.env.delete(a):(l+=`unalias: ${e}: not found
`,i=!0)}return{stdout:"",stderr:l,exitCode:+!!i}}},m={name:"alias",flags:[]},p={name:"unalias",flags:[{flag:"-a",type:"boolean"}]}},99223(e,t,a){function s(e){let t=`${e.name} - ${e.summary}

`;if(t+=`Usage: ${e.usage}
`,e.description){if(t+=`
Description:
`,"string"==typeof e.description)for(let a of e.description.split(`
`))t+=a?`  ${a}
`:`
`;else if(e.description.length>0)for(let a of e.description)t+=a?`  ${a}
`:`
`}if(e.options&&e.options.length>0)for(let a of(t+=`
Options:
`,e.options))t+=`  ${a}
`;if(e.examples&&e.examples.length>0)for(let a of(t+=`
Examples:
`,e.examples))t+=`  ${a}
`;if(e.notes&&e.notes.length>0)for(let a of(t+=`
Notes:
`,e.notes))t+=`  ${a}
`;return{stdout:t,stderr:"",exitCode:0}}function o(e){return e.includes("--help")}function r(e,t){return{stdout:"",stderr:t.startsWith("--")?`${e}: unrecognized option '${t}'
`:`${e}: invalid option -- '${t.replace(/^-/,"")}'
`,exitCode:1}}a.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,a(98995).createRequire)(__filename)}};