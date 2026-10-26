"use strict";exports.ids=["6686"],exports.modules={66517(e,i,a){a.d(i,{a:()=>p,b:()=>c});var l=a(98995),d=a(81643),u=a(79862),f=a(99223);(0,l.createRequire)(__filename);var m={name:"sleep",summary:"delay for a specified amount of time",usage:"sleep NUMBER[SUFFIX]",description:`Pause for NUMBER seconds. SUFFIX may be:
  s - seconds (default)
  m - minutes
  h - hours
  d - days

NUMBER may be a decimal number.`,options:["    --help display this help and exit"]},p={name:"sleep",async execute(e,i){if((0,f.b)(e))return(0,f.a)(m);if(0===e.length)return{stdout:"",stderr:`sleep: missing operand
`,exitCode:1};let a=0;for(let i of e){let e=(0,d.a)(i);if(null===e)return{stdout:"",stderr:`sleep: invalid time interval '${i}'
`,exitCode:1};a+=e}if(a>36e5&&(a=36e5),i.signal?.aborted)return{stdout:"",stderr:"",exitCode:0};if(i.sleep){let e=Promise.resolve(i.sleep(a));if(i.signal){let a,l=new Promise(e=>{a=e,i.signal?.addEventListener("abort",a,{once:!0}),i.signal?.aborted&&e()});try{await Promise.race([e,l])}finally{a&&i.signal.removeEventListener("abort",a)}}else await e}else i.signal?await new Promise(e=>{let t=()=>{(0,u.b)(l),e()},l=(0,u.a)(()=>{i.signal?.removeEventListener("abort",t),e()},a);i.signal?.addEventListener("abort",t,{once:!0})}):await new Promise(e=>(0,u.a)(e,a));return{stdout:"",stderr:"",exitCode:0}}},c={name:"sleep",flags:[],needsArgs:!0}},99223(e,i,a){function s(e){let i=`${e.name} - ${e.summary}

`;if(i+=`Usage: ${e.usage}
`,e.description){if(i+=`
Description:
`,"string"==typeof e.description)for(let a of e.description.split(`
`))i+=a?`  ${a}
`:`
`;else if(e.description.length>0)for(let a of e.description)i+=a?`  ${a}
`:`
`}if(e.options&&e.options.length>0)for(let a of(i+=`
Options:
`,e.options))i+=`  ${a}
`;if(e.examples&&e.examples.length>0)for(let a of(i+=`
Examples:
`,e.examples))i+=`  ${a}
`;if(e.notes&&e.notes.length>0)for(let a of(i+=`
Notes:
`,e.notes))i+=`  ${a}
`;return{stdout:i,stderr:"",exitCode:0}}function o(e){return e.includes("--help")}function r(e,i){return{stdout:"",stderr:i.startsWith("--")?`${e}: unrecognized option '${i}'
`:`${e}: invalid option -- '${i.replace(/^-/,"")}'
`,exitCode:1}}a.d(i,{a:()=>s,b:()=>o,c:()=>r}),(0,a(98995).createRequire)(__filename)},81643(e,i,a){function n(e){let i=e.match(/^(\d+\.?\d*)(s|m|h|d)?$/);if(!i)return null;let a=parseFloat(i[1]);switch(i[2]||"s"){case"s":return 1e3*a;case"m":return 60*a*1e3;case"h":return 60*a*6e4;case"d":return 24*a*36e5;default:return null}}a.d(i,{a:()=>n}),(0,a(98995).createRequire)(__filename)},11613(e,i,a){a.r(i),a.d(i,{flagsForFuzzing:()=>d.b,sleepCommand:()=>d.a});var l=a(98995),d=a(66517);a(81643),a(79862),a(8497),a(99223),a(7863),(0,l.createRequire)(__filename)}};