import {createInterface} from 'node:readline';
let sessionId='fixture-session',pending;const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
const update=u=>send({method:'session/update',params:{sessionId,update:u}});
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);
 if(!m.method){if(m.id==='permit'){update({sessionUpdate:'tool_call_update',toolCallId:'tool1',title:'Edit fixture',status:'completed',rawOutput:'synthetic tool result: fixture validated'});update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:m.result?.outcome?.optionId==='once'?'approved':'denied'}});send({id:pending,result:{stopReason:'end_turn'}});}return;}
 if(m.method==='initialize')return send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true}}});
 if(m.method==='session/new')return send({id:m.id,result:{sessionId}});
 if(m.method==='session/load'){sessionId=m.params.sessionId;update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'old replay'}});return send({id:m.id,result:{}});}
 if(m.method==='session/prompt'){
  if(process.env.FIXTURE_MODE==='unconfirmed'){pending=m.id;return;}
  if(m.params.prompt?.[0]?.text?.endsWith('GFOT_QUOTA_UI'))return send({id:m.id,result:{stopReason:'refusal',_meta:{'codebuddy.ai/errorMessage':'usage_limit_reached'}}});
  if(process.env.FIXTURE_MODE==='oversize'){process.stdout.write('x'.repeat(2000001));return;}
  pending=m.id;update({sessionUpdate:'agent_message_chunk',content:{type:'text',text:'你好 '}});
  send({id:'permit',method:'session/request_permission',params:{sessionId,toolCall:{toolCallId:'tool1',kind:'edit',title:'Edit fixture',rawInput:{file:'fixture.txt'}},options:[{optionId:'once',kind:'allow_once'},{optionId:'never',kind:'reject_once'},{optionId:'forever',kind:'allow_always'}]}});return;
 }
 if(m.method==='session/cancel'){if(process.env.FIXTURE_MODE==='unconfirmed')return;send({id:pending,result:{stopReason:'cancelled'}});return;}
 send({id:m.id,error:{code:-32601,message:'unsupported'}});
});
