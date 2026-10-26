"use strict";exports.ids=["9602"],exports.modules={99223(e,t,i){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}i.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,i(98995).createRequire)(__filename)},81643(e,t,i){function n(e){let t=e.match(/^(\d+\.?\d*)(s|m|h|d)?$/);if(!t)return null;let i=parseFloat(t[1]);switch(t[2]||"s"){case"s":return 1e3*i;case"m":return 60*i*1e3;case"h":return 60*i*6e4;case"d":return 24*i*36e5;default:return null}}i.d(t,{a:()=>n}),(0,i(98995).createRequire)(__filename)},17486(e,t,i){i.d(t,{a:()=>g,b:()=>p});var a=i(98995),l=i(81643),u=i(40768),d=i(79862),f=i(19506),m=i(99223);(0,a.createRequire)(__filename);var c={name:"timeout",summary:"run a command with a time limit",usage:"timeout [OPTION] DURATION COMMAND [ARG]...",description:`Start COMMAND, and kill it if still running after DURATION.

DURATION is a number with optional suffix:
  s - seconds (default)
  m - minutes
  h - hours
  d - days`,options:["-k, --kill-after=DURATION  send KILL signal after DURATION if still running","-s, --signal=SIGNAL        specify signal to send (default: TERM)","    --preserve-status      exit with same status as COMMAND, even on timeout","    --foreground           run command in foreground","    --help                 display this help and exit"]},g={name:"timeout",async execute(e,t){if((0,m.b)(e))return(0,m.a)(c);let i=0;for(let t=0;t<e.length;t++){let a=e[t];if("--preserve-status"===a)i=t+1;else if("--foreground"===a)i=t+1;else if("-k"===a||"--kill-after"===a)i=++t+1;else if(a.startsWith("--kill-after="))i=t+1;else if("-s"===a||"--signal"===a)i=++t+1;else if(a.startsWith("--signal="))i=t+1;else{if(a.startsWith("--")&&"--"!==a)return(0,m.c)("timeout",a);if(a.startsWith("-")&&a.length>1&&"--"!==a)if(a.startsWith("-k"))i=t+1;else{if(!a.startsWith("-s"))return(0,m.c)("timeout",a);i=t+1}else{i=t;break}}}let a=e.slice(i);if(0===a.length)return{stdout:"",stderr:`timeout: missing operand
`,exitCode:1};let g=a[0],p=(0,l.a)(g);if(null===p)return{stdout:"",stderr:`timeout: invalid time interval '${g}'
`,exitCode:1};let h=a.slice(1);if(0===h.length)return{stdout:"",stderr:`timeout: missing operand
`,exitCode:1};if(!t.exec)return{stdout:"",stderr:`timeout: exec not available
`,exitCode:1};let x=new AbortController,v=(0,u.a)(t.signal,x.signal),b,y;try{let e=new Promise(e=>{y=()=>e({timedOut:!0}),v.signal?.addEventListener("abort",y,{once:!0}),b=(0,d.a)(()=>{x.abort()},p)}),i=t.exec((0,f.a)([h[0]]),{cwd:t.cwd,signal:v.signal,stdin:t.stdin,stdinKind:"bytes",args:h.slice(1)}).then(e=>({timedOut:!1,result:e})),a=await Promise.race([e,i]);return a.timedOut?(await i.catch(()=>{}),{stdout:"",stderr:"",exitCode:124}):a.result}finally{void 0!==b&&(0,d.b)(b),y&&v.signal?.removeEventListener("abort",y),v.cleanup()}}},p={name:"timeout",flags:[{flag:"-k",type:"value",valueHint:"string"},{flag:"-s",type:"value",valueHint:"string"},{flag:"--preserve-status",type:"boolean"},{flag:"--foreground",type:"boolean"}],needsArgs:!0,minArgs:2}},63145(e,t,i){i.r(t),i.d(t,{flagsForFuzzing:()=>l.b,timeoutCommand:()=>l.a});var a=i(98995),l=i(17486);i(81643),i(40768),i(79862),i(19506),i(8497),i(29486),i(99223),i(7863),(0,a.createRequire)(__filename)}};