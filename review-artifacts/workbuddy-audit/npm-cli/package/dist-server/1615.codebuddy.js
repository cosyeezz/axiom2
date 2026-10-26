"use strict";exports.ids=["1615"],exports.modules={24038(e,a,t){t.d(a,{a:()=>n,b:()=>i});var s=t(98995),r=t(19506);(0,s.createRequire)(__filename);var l=new Map([["File operations",["ls","cat","head","tail","wc","touch","mkdir","rm","cp","mv","ln","chmod","stat","readlink"]],["Text processing",["grep","sed","awk","sort","uniq","cut","tr","tee","diff"]],["Search",["find"]],["Navigation & paths",["pwd","basename","dirname","tree","du"]],["Environment & shell",["echo","printf","env","printenv","export","alias","unalias","history","clear","true","false","bash","sh"]],["Data processing",["xargs","jq","base64","date"]],["Network",["curl","html-to-markdown"]]]);function d(e){let a=[],t=new Set(e);a.push(`Available commands:
`);let s=[];for(let[e,s]of l){let r=s.filter(e=>t.has(e));if(r.length>0)for(let s of(a.push(`  ${e}:`),a.push(`    ${r.join(", ")}
`),r))t.delete(s)}for(let e of t)s.push(e);return s.length>0&&(a.push("  Other:"),a.push(`    ${s.sort().join(", ")}
`)),a.push("Use '<command> --help' for details on a specific command."),`${a.join(`
`)}
`}var n={name:"help",async execute(e,a){if(e.includes("--help")||e.includes("-h"))return{stdout:`help - display available commands

Usage: help [command]

Options:
  -h, --help    Show this help message

If a command name is provided, shows help for that command.
Otherwise, lists all available commands.
`,stderr:"",exitCode:0};if(e.length>0&&a.exec){let t=e[0];return a.exec((0,r.a)([t]),{cwd:a.cwd,signal:a.signal,args:["--help"]})}return{stdout:d(a.getRegisteredCommands?.()??[]),stderr:"",exitCode:0}}},i={name:"help",flags:[]}},8642(e,a,t){t.r(a),t.d(a,{flagsForFuzzing:()=>r.b,helpCommand:()=>r.a});var s=t(98995),r=t(24038);t(19506),t(7863),(0,s.createRequire)(__filename)}};