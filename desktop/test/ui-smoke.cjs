// Run separately with Electron on macOS. All model output is synthetic/local.
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gfot-ui-smoke-'));
const resources=process.env.GFOT_QA_RESOURCES;
if(resources){Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:resources});}
app.setPath('userData',path.join(dir,'appdata'));
const report=process.env.GFOT_QA_REPORT||path.join(os.tmpdir(),'gfot-ui-smoke.json');
const models=[],requestBodies=[];let diagnostics=0;
const projectDir=path.join(dir,'project');fs.mkdirSync(projectDir);fs.writeFileSync(path.join(projectDir,'fixture.txt'),'Synthetic project source');
const fixtureAuth=path.join(dir,'synthetic-codex-auth.json');
const fixtureAccess='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({iss:'https://auth.openai.com',sub:'native-import-test',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture-signature';
fs.writeFileSync(fixtureAuth,JSON.stringify({tokens:{access_token:fixtureAccess,account_id:'native-test-account',refresh_token:'do-not-copy'}}),{mode:0o600});
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixtureAuth]}); // Simulated OS file choice only; production IPC and file read remain real.

const gateway=http.createServer(async(req,res)=>{
 if(req.url==='/v1/models'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({data:[{id:'alpha'},{id:'beta'}]}));}
 const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());
 if(body.stream===false){diagnostics++;res.setHeader('content-type','application/json');return res.end(JSON.stringify({choices:[{message:body.tools?{role:'assistant',tool_calls:[{id:'diagnostic-1',type:'function',function:{name:'gfot_connection_probe',arguments:'{"ok":true}'}}]}:{role:'assistant',content:'Diagnostic completed'}}]}));}
 const requestText=JSON.stringify(body.messages||[]);requestBodies.push(requestText);
 const content=requestText.includes('GFOT OUTPUT CONTRACT')?JSON.stringify({harness:{'systemprompt.md':'H2_FIXTURE_ADOPTED: inspect source and verify results.','guardrails.md':'Respect approval requests. Never access the original project from a copy.','LongTermMEMORY.md':'Use observed task evidence.','tool_descriptions/tool_guidance.md':'Read relevant files and report checks.'},notes:'Synthetic evidence only; no claim of real-provider quality improvement.'}):'Synthetic local UI test completed.';
 models.push(body.model);res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'synthetic',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{content},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.on('browser-window-created',(_event,win)=>{win.webContents.once('did-finish-load',async()=>{try{
 const js=source=>win.webContents.executeJavaScript(source);
 const until=async expression=>{for(let i=0;i<1000;i++){const value=await js(expression);if(value)return value;await delay(50);}throw Error('UI condition timed out: '+expression);};
 const api=async(route,body)=>js(`fetch('/api/${route}',{method:'${body===undefined?'GET':'POST'}',headers:{'content-type':'application/json'},body:${body===undefined?'undefined':JSON.stringify(JSON.stringify(body))}}).then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);return data;})`);
 await until("document.body.innerText.includes('一个项目')");
 await until("Array.from(document.querySelectorAll('img')).every(img => img.complete && img.naturalWidth > 0)");
 assert.equal(await js('typeof require'),'undefined');assert.equal(await js('typeof gfotDesktop.chooseFolder'),'function');assert.equal(await js('typeof gfotDesktop.importCodex'),'function');assert.equal(await js('typeof gfotDesktop.loginChatGPT'),'function');
 fs.writeFileSync(path.join(os.tmpdir(),'gfot-desktop.png'),(await win.webContents.capturePage()).toPNG());
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
 const baseURL='http://127.0.0.1:'+gateway.address().port+'/v1';
 await js("document.querySelector('#settings').click();document.querySelector('#add-profile').click()");
 await js(`document.querySelector('#connection-preset').value='proxy';document.querySelector('#connection-preset').dispatchEvent(new Event('change'));const f=document.querySelector('#modal-form');f.elements.label.value='Synthetic Alpha';f.elements.baseURL.value=${JSON.stringify(baseURL)};f.elements.apiKey.value='fixture-ui-key';document.querySelector('#load-models').click()`);
 await until("document.querySelector('#model-discovery-note').textContent.includes('找到 2 个模型')");
 await js("document.querySelector('#modal-form').elements.model.value='alpha';document.querySelector('#modal-form').requestSubmit()");
 await until("!document.querySelector('#dialog').open");
 const one=(await api('state')).profiles[0];
 await js("document.querySelector('#settings').click();document.querySelector('#import-codex').click()");
 await until("document.querySelector('#dialog-body').innerText.includes('选择订阅模型')");
 const imported=await api('state');assert.equal(imported.accounts.length,1);assert.equal(imported.accounts[0].source,'codex-local');assert.equal(imported.accounts[0].canRefresh,false);assert.ok(!JSON.stringify(imported).includes(fixtureAccess));
 await js("document.querySelector('#modal-close').click()");

 await js("document.querySelector('#settings').click();document.querySelector('[data-verify-profile]').click();document.querySelector('#modal-form').requestSubmit()");
 assert.equal(diagnostics,0,'diagnostic requires explicit consent');
 await js("document.querySelector('#modal-form input[type=checkbox]').checked=true;document.querySelector('#modal-form').requestSubmit()");
 await until("document.querySelector('#verification-result').textContent.includes('推理与工具结果回传通过')");
 assert.equal(diagnostics,2);assert.equal((await api('state')).profiles[0].verification.toolCalling,true);
 await js("document.querySelector('#modal-close').click()");
 const two=(await api('profiles',{label:'Synthetic Beta',baseURL,model:'beta'})).profiles[1];
 const {taskId}=await api('tasks',{title:'Synthetic UI smoke',folder:projectDir,profileId:one.id});
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
 win.setSize(840,600);await delay(200);
 const compact=await js(`({viewport:innerWidth,body:document.documentElement.scrollWidth,send:document.querySelector('#composer button[type=submit]').getBoundingClientRect().right})`);
 assert.ok(compact.body<=compact.viewport && compact.send<=compact.viewport,'compact layout must keep the send button visible');
 fs.writeFileSync(path.join(os.tmpdir(),'gfot-desktop-compact.png'),(await win.webContents.capturePage()).toPNG());
 win.setSize(1240,820);await delay(200);
 const beforeH2=await api('state');assert.equal(beforeH2.harness2.available,true,'UI H2 test requires Python 3.12/3.13');
 await js("document.querySelector('#h2-optimize').click();document.querySelector('#modal-form').elements.text.value='Explain the fixture; do not modify files.';document.querySelector('#modal-form input[type=checkbox]').checked=true;document.querySelector('#modal-form').requestSubmit()");
 await until("document.querySelector('#h2-adopt') && document.querySelector('#status').textContent==='等待任务'");
 const h2=(await api('state')).tasks[0].harnessRun;assert.equal(h2.result.method.ledger.R,4);assert.equal(h2.result.method.ledger.P,3);
 assert.equal(fs.readFileSync(path.join(projectDir,'fixture.txt'),'utf8'),'Synthetic project source');
 await js("document.querySelector('#h2-adopt').click()");await until("document.querySelector('#h2-clear')");
 await js("document.querySelector('#prompt').value='Continue after harness adoption';document.querySelector('#composer').requestSubmit()");
 await until("document.querySelector('#messages').innerText.includes('Continue after harness adoption') && document.querySelector('#status').textContent==='等待任务'");
 assert.ok(requestBodies.at(-1).includes('H2_FIXTURE_ADOPTED'),'adopted prompt must reach the real executor');
 fs.writeFileSync(path.join(os.tmpdir(),'gfot-harness2.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(os.tmpdir(),'gfot-desktop-task.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(report,JSON.stringify({ok:true,packagedResources:!!resources,models,diagnostics,checks:['real Harness2 core with real OpenCode: 4 probes and 3 proposal stages','explicit harness adoption reaches next normal execution','source fixture unchanged by H2','Codex import IPC with simulated file choice','credentials absent from renderer state','model discovery via setup form','explicit diagnostic consent','inference and tool-result verification','sandboxed renderer','native folder IPC bridge','profile selection survives connection edit','two real OpenCode model turns in same conversation','settings dialog','brand SVG assets loaded','840px composer stays within viewport','screenshot']},null,2));
 }catch(error){fs.writeFileSync(report,JSON.stringify({ok:false,error:String(error),stack:error.stack}));gateway.close();app.exit(1);}finally{gateway.close();app.quit();}});});
require(resources?path.join(resources,'app.asar','desktop','main.cjs'):path.join(__dirname,'..','main.cjs'));
setTimeout(()=>{fs.writeFileSync(report,JSON.stringify({ok:false,error:'120s timeout'}));app.exit(1);},120000).unref();
