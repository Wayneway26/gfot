import {startDesktopServer} from './backend.mjs';
let service;
process.parentPort.on('message',async event=>{
 const message=event.data;
 if(message.type==='start'){
  try{service=await startDesktopServer({...message,key:Buffer.from(message.key,'base64')});process.parentPort.postMessage({type:'ready',url:service.url,auth:service.auth});}catch{process.parentPort.postMessage({type:'failed'});}
 }else if(message.type==='stop'){await service?.close();process.exit(0);}
});
