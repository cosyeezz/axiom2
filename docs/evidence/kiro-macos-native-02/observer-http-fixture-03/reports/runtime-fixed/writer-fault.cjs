'use strict';
const fs=require('node:fs');const open=fs.openSync,write=fs.writeSync;let target=null,hits=0;
fs.openSync=function(...args){const fd=Reflect.apply(open,this,args);if(args[0]===process.env.AXIOM_FAKE_TRACE&&args[1]==='wx'){target=fd;fs.writeFileSync(process.env.FAULT_RECORD,JSON.stringify({targetFD:fd,openFlags:args[1],trace:args[0]}),{flag:'wx'});}return fd;};
fs.writeSync=function(fd,...rest){if(fd===target){fs.writeSync=write;hits++;fs.writeFileSync(process.env.FAULT_HITS,JSON.stringify({targetFD:target,hits}));throw new Error('test-only exact trace FD write failure');}return Reflect.apply(write,this,[fd,...rest]);};
