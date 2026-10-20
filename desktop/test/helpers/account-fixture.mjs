export const token=(extra={})=>'eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({iss:'https://auth.openai.com',sub:'fixture-subject',exp:Math.floor(Date.now()/1000)+3600,...extra})).toString('base64url')+'.fixture-signature';
export const codexDocument=(id='fixture-account')=>JSON.stringify({tokens:{access_token:token({sub:id}),account_id:id,refresh_token:'MUST-NOT-IMPORT-SHARED-REFRESH'}});
export function responseSSE({model='fixture',tool,text='Synthetic Responses complete',id='response-fixture'}={}){
 const usage={input_tokens:20,output_tokens:10,total_tokens:30,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}};
 const response={id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',model,output:[],usage:null};
 const item=tool?{type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:tool.name,arguments:JSON.stringify(tool.args),status:'completed'}:{type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
 const events=[{type:'response.created',response}];
 if(tool)events.push({type:'response.output_item.added',output_index:0,item:{...item,arguments:'',status:'in_progress'}},{type:'response.function_call_arguments.delta',output_index:0,item_id:item.id,delta:item.arguments},{type:'response.function_call_arguments.done',output_index:0,item_id:item.id,arguments:item.arguments});
 else events.push({type:'response.output_item.added',output_index:0,item:{...item,content:[],status:'in_progress'}},{type:'response.content_part.added',output_index:0,item_id:item.id,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,item_id:item.id,content_index:0,delta:text},{type:'response.output_text.done',output_index:0,item_id:item.id,content_index:0,text},{type:'response.content_part.done',output_index:0,item_id:item.id,content_index:0,part:item.content[0]});
 events.push({type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:{...response,status:'completed',output:[item],usage}});
 return new Response(events.map((event,index)=>'event: '+event.type+'\ndata: '+JSON.stringify({...event,sequence_number:index})+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
}
