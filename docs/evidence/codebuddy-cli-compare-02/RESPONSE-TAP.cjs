'use strict';
const {responseProjection}=require('./PROJECTION.cjs');
// Observe actual IncomingMessage events before SDK listeners. No text or error message escapes RAM.
module.exports=function tap(response,record,kind,latch){
  let bytes=0,parts=[],saved=false;
  const limit=kind==='catalog'?1048576:65536,emit=response.emit;
  const save=exit=>{
    (record.responseExits??=[]).includes(exit)||record.responseExits.push(exit);
    if(exit==='end')record.responseEnded=true;
    if(exit==='aborted')record.aborted=true;
    if(saved)return;
    saved=true;record.responseExit=exit;record.responseBytes=bytes;
    if(kind==='model'){
      try{record.response=responseProjection(Buffer.concat(parts),response.headers);}
      catch{record.responseProjectionError=true;}
    }
    parts=[];
    record.protocolComplete=kind==='model'&&record.response?.strictTerminal===true;
    record.transportComplete=exit==='end';
  };
  response.emit=function(name,...args){
    if(name==='data'){
      bytes+=args[0].length;
      if(bytes>limit){save('limit');response.destroy();latch('RESPONSE_BYTES');return false;}
      if(kind==='model'&&!saved)parts.push(Buffer.from(args[0]));
    }
    if(['end','aborted','error','close'].includes(name)){
      save(name);
      if(record.responseProjectionError)latch('RESPONSE_PROJECTION');
      if(kind!=='telemetry'){
        const expectedAbortError=name==='error'&&record.responseExit==='aborted'&&record.protocolComplete&&['ECONNRESET','ABORT_ERR'].includes(args[0]?.code);
        if(name==='error'){
          record.responseErrorKind=expectedAbortError?'classified-after-abort':'other';
          if(!expectedAbortError)latch('RESPONSE_ERROR');
        }
        if(name==='close'&&record.responseExit==='close')latch('RESPONSE_UNCLASSIFIED_CLOSE');
        if(name!=='end'&&!record.responseEnded&&!record.protocolComplete)latch('RESPONSE_INCOMPLETE');
      }
    }
    return emit.call(this,name,...args);
  };
};
