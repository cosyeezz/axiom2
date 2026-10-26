"use strict";exports.ids=["2685"],exports.modules={52281(e,t,a){a.d(t,{a:()=>I});var n=a(98995),f=a(29486),i=a(99223);(0,n.createRequire)(__filename);var d=new Map([["sha1","SHA-1"],["sha256","SHA-256"]]);function D(e){function h(e,t){return e<<t|e>>>32-t}let t=new Uint32Array([0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x2441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x4881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391]),a=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21],n=8*e.length,f=(e.length%64<56?56:120)-e.length%64,i=new Uint8Array(e.length+f+8);i.set(e),i[e.length]=128;let d=new DataView(i.buffer);d.setUint32(i.length-8,n>>>0,!0),d.setUint32(i.length-4,Math.floor(n/0x100000000),!0);let l=0x67452301,c=0xefcdab89,x=0x98badcfe,u=0x10325476;for(let e=0;e<i.length;e+=64){let n=new Uint32Array(16);for(let t=0;t<16;t++)n[t]=d.getUint32(e+4*t,!0);let f=l,i=c,b=x,p=u;for(let e=0;e<64;e++){let d,l;e<16?(d=i&b|~i&p,l=e):e<32?(d=p&i|~p&b,l=(5*e+1)%16):e<48?(d=i^b^p,l=(3*e+5)%16):(d=b^(i|~p),l=7*e%16),d=d+f+t[e]+n[l]>>>0,f=p,p=b,b=i,i=i+h(d,a[e])>>>0}l=l+f>>>0,c=c+i>>>0,x=x+b>>>0,u=u+p>>>0}let b=new Uint8Array(16);return new DataView(b.buffer).setUint32(0,l,!0),new DataView(b.buffer).setUint32(4,c,!0),new DataView(b.buffer).setUint32(8,x,!0),new DataView(b.buffer).setUint32(12,u,!0),Array.from(b).map(e=>e.toString(16).padStart(2,"0")).join("")}async function C(e,t){if("md5"===e)return D(t);let a=d.get(e);if(!a)throw Error(`Unknown algorithm: ${e}`);let n=await globalThis.crypto.subtle.digest(a,new Uint8Array(t).buffer);return Array.from(new Uint8Array(n)).map(e=>e.toString(16).padStart(2,"0")).join("")}function I(e,t,a){let n={name:e,summary:a,usage:`${e} [OPTION]... [FILE]...`,options:["-c, --check    read checksums from FILEs and check them","    --help     display this help and exit"]};return{name:e,async execute(a,d){if((0,i.b)(a))return(0,i.a)(n);let l=!1,c=[];for(let t of a)if("-c"===t||"--check"===t)l=!0;else if("-b"!==t&&"-t"!==t&&"--binary"!==t&&"--text"!==t){if(t.startsWith("-")&&"-"!==t)return(0,i.c)(e,t);c.push(t)}0===c.length&&c.push("-");let w=async e=>{if("-"===e)return Uint8Array.from(d.stdin,e=>e.charCodeAt(0));try{return await d.fs.readFileBuffer(d.fs.resolvePath(d.cwd,e))}catch{return null}};if(l){let a=0,n="";for(let i of c){let l="-"===i?(0,f.d)(d.stdin):await d.fs.readFile(d.fs.resolvePath(d.cwd,i)).catch(()=>null);if(null===l)return{stdout:"",stderr:`${e}: ${i}: No such file or directory
`,exitCode:1};for(let e of l.split(`
`)){let f=e.match(/^([a-fA-F0-9]+)\s+[* ]?(.+)$/);if(!f)continue;let[,i,d]=f,l=await w(d);if(null===l){n+=`${d}: FAILED open or read
`,a++;continue}let c=await C(t,l)===i.toLowerCase();n+=`${d}: ${c?"OK":"FAILED"}
`,c||a++}}return a>0&&(n+=`${e}: WARNING: ${a} computed checksum${a>1?"s":""} did NOT match
`),{stdout:n,stderr:"",exitCode:+(a>0)}}let x="",u=0;for(let a of c){let n=await w(a);if(null===n){x+=`${e}: ${a}: No such file or directory
`,u=1;continue}x+=`${await C(t,n)}  ${a}
`}return{stdout:x,stderr:"",exitCode:u}}}}},25390(e,t,a){a.d(t,{a:()=>i,b:()=>d});var n=a(98995),f=a(52281);(0,n.createRequire)(__filename);var i=(0,f.a)("sha256sum","sha256","compute SHA256 message digest"),d={name:"sha256sum",flags:[{flag:"-c",type:"boolean"}],needsFiles:!0}},99223(e,t,a){function s(e){let t=`${e.name} - ${e.summary}

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
`,exitCode:1}}a.d(t,{a:()=>s,b:()=>o,c:()=>r}),(0,a(98995).createRequire)(__filename)},83852(e,t,a){a.r(t),a.d(t,{flagsForFuzzing:()=>f.b,sha256sumCommand:()=>f.a});var n=a(98995),f=a(25390);a(52281),a(29486),a(99223),a(7863),(0,n.createRequire)(__filename)}};