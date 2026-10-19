// Run separately with Electron on macOS. All model output is synthetic/local.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gfot-ui-smoke-'));
const resources=process.env.GFOT_QA_RESOURCES;
if(resources){Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:resources});}
app.setPath('userData',path.join(dir,'appdata'));
const report=process.env.GFOT_QA_REPORT||path.join(os.tmpdir(),'gfot-ui-smoke.json');
const models=[];let diagnostics=0;
const gateway=http.createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'alpha'},{id:'beta'}]}));}
 const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());
 if(body.stream===false){diagnostics++;res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:body.tools?{role:'assistant',tool_calls:[{id:'diagnostic-1',type:'function',function:{name:'gfot_connection_probe',arguments:'{"ok":true}'}}]}:{role:'assistant',content:'Diagnostic completed'}}]}));}
 models.push(body.model);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{content:'Synthetic local UI test completed.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(_event,win)=>{win.webContents.once('did-finish-load',async()=>{try{
 const js=source=>win.webContents.executeJavaScript(source);
 const until=async expression=>{for(let i=0;i<400;i++){const value=await js(expression);if(value)return value;await delay(50);}throw Error('UI condition timed out: '+expression);};
 const api=async(route,body)=>js(`fetch('/api/${route}',{method:'${body===undefined?'GET':'POST'}',headers:{'content-type':'application/json'},body:${body===undefined?'undefined':JSON.stringify(JSON.stringify(body))}}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;})`);
 await until("document.body.innerText.includes('一个项目')");
 assert.equal(await js('typeof require'),'undefined');assert.equal(await js('typeof gfotDesktop.chooseFolder'),'function');
 fs.writeFileSync(path.join(os.tmpdir(),'gfot-desktop.png'),(await win.webContents.capturePage()).toPNG());
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const baseURL='http://127.0.0.1:'+gateway.address().port+'/v1';
 await js("document.querySelector('#settings').click();document.querySelector('#add-profile').click()");
 await js(`document.querySelector('#connection-preset').value='proxy';document.querySelector('#connection-preset').dispatchEvent(new Event('change'));const f=document.querySelector('#modal-form');f.elements.label.value='Synthetic Alpha';f.elements.baseURL.value=${JSON.stringify(baseURL)};f.elements.apiKey.value='fixture-ui-key';document.querySelector('#load-models').click()`);
 await until("document.querySelector('#model-discovery-note').textContent.includes('找到 2 个模型')");
 await js("document.querySelector('#modal-form').elements.model.value='alpha';document.querySelector('#modal-form').requestSubmit()");
 await until("!document.querySelector('#dialog').open");
 const one=(await api('state')).profiles[0];
 await js("document.querySelector('#settings').click();document.querySelector('[data-verify-profile]').click();document.querySelector('#modal-form').requestSubmit()");
 assert.equal(diagnostics,0,'diagnostic requires explicit consent');
 await js("document.querySelector('#modal-form input[type=checkbox]').checked=true;document.querySelector('#modal-form').requestSubmit()");
 await until("document.querySelector('#verification-result').textContent.includes('推理与工具结果回传通过')");
 assert.equal(diagnostics,2);assert.equal((await api('state')).profiles[0].verification.toolCalling,true);
 await js("document.querySelector('#modal-close').click()");
 const two=(await api('profiles',{label:'Synthetic Beta',baseURL,model:'beta'})).profiles[1];
 const {taskId}=await api('tasks',{title:'Synthetic UI smoke',folder:dir,profileId:one.id});
 await until(`!!document.querySelector('[data-task="${taskId}"]')`);
 await js(`document.querySelector('[data-task="${taskId}"]').click()`);
 await js("document.querySelector('#prompt').value='Synthetic first turn';document.querySelector('#composer').requestSubmit()");
 await until("document.querySelector('#status').textContent==='等待任务' && document.querySelector('#messages').innerText.includes('Synthetic local UI test completed.')");
 await js(`document.querySelector('#profile-select').value='${two.id}'`);
 await api('profiles',{label:'Synthetic Gamma',baseURL,model:'gamma'});
 await until("document.querySelector('#profile-select').options.length===3");
 assert.equal(await js("document.querySelector('#profile-select').value"),two.id,'connection edits must preserve selected model');
 await js("document.querySelector('#prompt').value='Synthetic second turn';document.querySelector('#composer').requestSubmit()");
 await until("document.querySelector('#messages').innerText.includes('Synthetic second turn') && document.querySelector('#status').textContent==='等待任务'");
 assert.deepEqual(models,['alpha','beta']);
 const state=await api('state');assert.equal(state.tasks[0].messages.length,4);
 await js("document.querySelector('#settings').click()");assert.equal(await js("document.querySelector('#dialog').open"),true);await js("document.querySelector('#settings-close').click()");
 fs.writeFileSync(path.join(os.tmpdir(),'gfot-desktop-task.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(report,JSON.stringify({ok:true,packagedResources:!!resources,models,diagnostics,checks:['model discovery via setup form','explicit diagnostic consent','inference and tool-result verification','sandboxed renderer','native folder IPC bridge','profile selection survives connection edit','two real OpenCode model turns in same conversation','settings dialog','screenshot']},null,2));
 }catch(error){fs.writeFileSync(report,JSON.stringify({ok:false,error:String(error),stack:error.stack}));gateway.close();app.exit(1);}finally{gateway.close();app.quit();}});});
require(resources?path.join(resources,'app.asar','desktop','main.cjs'):path.join(__dirname,'..','main.cjs'));
setTimeout(()=>{fs.writeFileSync(report,JSON.stringify({ok:false,error:'120s timeout'}));app.exit(1);},120000).unref();
