import http from 'node:http';

export function claudeResponse(model,block){
 const tool=block.type==='tool_use',events=[
  {type:'message_start',message:{id:'cc-message-'+Math.random(),type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:10,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:tool?{...block,input:{}}:{type:'text',text:''}},
  {type:'content_block_delta',index:0,delta:tool?{type:'input_json_delta',partial_json:JSON.stringify(block.input)}:{type:'text_delta',text:block.text}},
  {type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn',stop_sequence:null},usage:{output_tokens:10}},{type:'message_stop'}];
 return events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
}
export async function claudeModel({folder,external,fetchBody}={}){
 const requests=[];
 const server=http.createServer(async(req,res)=>{
  let text='';for await(const c of req)text+=c;const body=JSON.parse(text);requests.push({path:req.url,body,headers:req.headers});fetchBody?.(body);
  const messages=body.messages||[],plain=messages.filter(m=>m.role==='user').flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(c=>c.type==='text').map(c=>c.text));
  const marker=Array.from(plain.join('\n').matchAll(/GFOT_CLAUDE_[A-Z_]+/g),m=>m[0]).at(-1),results=messages.flatMap(m=>Array.isArray(m.content)?m.content.filter(c=>c.type==='tool_result'):[]),done=id=>results.some(r=>r.tool_use_id===id);
  const call=(id,name,input)=>({type:'tool_use',id,name,input});let block;
  if(marker==='GFOT_CLAUDE_CHILD'&&!done('cc-agent'))block=call('cc-agent','Agent',{description:'Read fixture',subagent_type:'general-purpose',prompt:'GFOT_CLAUDE_CHILD_READ: Read '+folder+'/source.txt and report briefly.'});
  else if(marker==='GFOT_CLAUDE_CHILD_READ'&&!done('cc-child-read'))block=call('cc-child-read','Read',{file_path:folder+'/source.txt'});
  else if(marker==='GFOT_CLAUDE_QUESTION'&&!done('cc-question'))block=call('cc-question','AskUserQuestion',{questions:[{question:'Which color?',header:'Color',options:[{label:'Blue',description:'Blue option'},{label:'Red',description:'Red option'}],multiSelect:false}]});
  else if(marker==='GFOT_CLAUDE_GLOB'&&!done('cc-glob'))block=call('cc-glob','Glob',{pattern:'../*.txt',path:folder});
  else if(marker==='GFOT_CLAUDE_EXTERNAL'&&!done('cc-external'))block=call('cc-external','Read',{file_path:external});
  else if(marker==='GFOT_CLAUDE_STOP'&&!done('cc-stop'))block=call('cc-stop','Write',{file_path:folder+'/stopped.txt',content:'must not be written'});
  else if(marker==='GFOT_CLAUDE_WRITE'&&!done('cc-read'))block=call('cc-read','Read',{file_path:folder+'/source.txt'});
  else if(marker==='GFOT_CLAUDE_WRITE'&&!done('cc-write'))block=call('cc-write','Write',{file_path:folder+'/result.txt',content:'written by native Claude'});
  else block={type:'text',text:marker==='GFOT_CLAUDE_CHILD_READ'?'Child public result':'Claude fixture completed'};
  res.writeHead(200,{'content-type':'text/event-stream'});res.end(claudeResponse(body.model,block));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {baseURL:'http://127.0.0.1:'+server.address().port+'/v1',requests,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
