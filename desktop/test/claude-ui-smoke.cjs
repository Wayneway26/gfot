// Actual Electron, SDK and selected native Claude runtime; synthetic models only.
const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gfot-claude-ui-')),project=path.join(dir,'project');fs.mkdirSync(project);fs.writeFileSync(path.join(project,'source.txt'),'Synthetic Claude UI source');
const binary=process.env.GFOT_TEST_CLAUDE_BIN;if(!binary)throw Error('GFOT_TEST_CLAUDE_BIN must identify the test-only native runtime');
const report=process.env.GFOT_QA_REPORT||path.join(os.tmpdir(),'gfot-claude-ui.json');fs.rmSync(report,{force:true});
const resources=process.env.GFOT_QA_RESOURCES;if(resources){Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:resources});}
app.setPath('userData',path.join(dir,'data'));
dialog.showOpenDialog=async(_window,options)=>({canceled:false,filePaths:[options.title.includes('Claude Code')?binary:project]});
dialog.showErrorBox=(title,message)=>{if(!fs.existsSync(report))fs.writeFileSync(report,JSON.stringify({ok:false,error:title+': '+message}));app.exit(1);};
let model;
app.on('browser-window-created',(_event,win)=>{win.webContents.setBackgroundThrottling(false);win.webContents.once('did-finish-load',async()=>{
 const js=code=>{fs.appendFileSync(report+'.steps',code+'\n');return win.webContents.executeJavaScript(code)},wait=async expression=>{for(let i=0;i<1000;i++){if(await js(expression))return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out: '+expression);};
 const api=(route,body)=>js(`fetch('/api/'+${JSON.stringify(route)},{method:${body===undefined?'"GET"':'"POST"'},headers:{'content-type':'application/json'},body:${body===undefined?'undefined':JSON.stringify(JSON.stringify(body))}}).then(async r=>{const d=await r.json();if(!r.ok)throw Error(d.error);return d;})`);
 try{
  model=await (await import('./helpers/claude-model.mjs')).claudeModel({folder:project});
  await wait("!!document.querySelector('#settings')");await api('state');await new Promise(r=>setTimeout(r,250));await js("document.querySelector('#settings').click()");await wait("!!document.querySelector('[data-select-claude]')");await js("document.querySelector('[data-select-claude]').click()");
  await wait("document.querySelector('[data-select-claude]')?.textContent==='更换执行文件'");
  const selected=await api('state');assert.equal(selected.runtimes.claude.version,'2.1.312');
  await js("document.querySelector('#add-profile').click()");
  await js(`(()=>{const f=document.querySelector('#modal-form');f.elements.mode.value='local';f.elements.protocol.value='anthropic';f.elements.label.value='Claude synthetic';f.elements.baseURL.value=${JSON.stringify(model.baseURL)};f.elements.model.value='claude-sonnet-4-6';f.elements.apiKey.value='upstream-synthetic-ui';f.requestSubmit();})()`);
  await wait("!document.querySelector('#dialog').open");await js("document.querySelector('#new-task').click()");await wait("!!document.querySelector('#modal-form')?.elements.agentId");
  await js("(()=>{const f=document.querySelector('#modal-form');f.elements.agentId.value='claude';f.elements.agentId.dispatchEvent(new Event('change'));f.querySelector('input[type=checkbox]').checked=true;f.requestSubmit();})()");await wait("!document.querySelector('#dialog').open && document.querySelector('#agent-select').value==='claude'");
  assert.equal(await js("document.querySelector('#h2-optimize').disabled"),true);
  const send=async text=>js(`document.querySelector('#prompt').value=${JSON.stringify(text)};document.querySelector('#composer').requestSubmit()`);
  await send('GFOT_CLAUDE_WRITE');await wait("!!document.querySelector('[data-permission][data-reply=once]')");assert.equal(fs.existsSync(path.join(project,'result.txt')),false);assert.ok(await js("document.querySelector('#approvals').textContent.includes('result.txt')"));
  await js("document.querySelector('[data-permission][data-reply=once]').click()");await wait("document.querySelector('#status').textContent==='等待任务'");assert.equal(fs.readFileSync(path.join(project,'result.txt'),'utf8'),'written by native Claude');assert.ok(await js("document.querySelector('#messages').textContent.includes('Claude fixture completed')"));
  const session=(await api('state')).tasks[0].sessionId;
  await send('GFOT_CLAUDE_QUESTION');await wait("!!document.querySelector('.question-form')");await js("document.querySelector('.question-form input').value='Blue';document.querySelector('.question-form').requestSubmit()");await wait("document.querySelector('#status').textContent==='等待任务'");assert.ok(JSON.stringify(model.requests.at(-1).body.messages).includes('Blue'));
  await send('GFOT_CLAUDE_RESUME');await wait("document.querySelector('#status').textContent==='等待任务' && document.querySelector('#messages').textContent.includes('GFOT_CLAUDE_RESUME')");assert.equal((await api('state')).tasks[0].sessionId,session);
  await send('GFOT_CLAUDE_STOP');await wait("!!document.querySelector('[data-permission][data-reply=once]')");await js("document.querySelector('#stop').click()");await wait("document.querySelector('#status').textContent==='已停止'");assert.equal(fs.existsSync(path.join(project,'stopped.txt')),false);
  const state=await api('state');assert.ok(!JSON.stringify(state).includes('upstream-synthetic-ui'));for(const request of model.requests)assert.equal(request.headers['x-api-key'],'upstream-synthetic-ui');
  const screenshot=path.join(path.dirname(report),'gfot-claude-task.png');fs.writeFileSync(screenshot,(await win.webContents.capturePage()).toPNG());
  fs.writeFileSync(report,JSON.stringify({ok:true,packagedResources:!!resources,version:'2.1.312',checks:['native executable selection through real IPC with a simulated file picker','Anthropic-only connection UI','real Claude SDK and native tool execution through host-owned proxy','visible write approval before mutation','native question answered in gfot','exact session resumed between native processes','stop cancels pending approval and prevents mutation','credentials hidden from renderer state','Harness2 probes remain disabled for Claude','screenshot'],screenshot},null,2));
 }catch(error){fs.writeFileSync(report,JSON.stringify({ok:false,error:error.message,stack:error.stack}));app.exit(1);}finally{await model?.close();app.quit();}
 });});
require(resources?path.join(resources,'app.asar/desktop/main.cjs'):path.join(__dirname,'../main.cjs'));
setTimeout(()=>{if(!fs.existsSync(report))fs.writeFileSync(report,JSON.stringify({ok:false,error:'UI timeout'}));app.exit(1);},120000).unref();
