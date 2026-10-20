const {app,BrowserWindow,ipcMain,dialog,utilityProcess,safeStorage,Menu,shell}=require('electron');
const {join}=require('node:path');
const {readFileSync,writeFileSync,mkdirSync,existsSync,statSync}=require('node:fs');
const {randomBytes}=require('node:crypto');
app.setName('gfot');
let window,worker,base,quitting=false;
const root=join(__dirname,'..');
function engineBinary(){return app.isPackaged?join(process.resourcesPath,'engine','opencode'):join(root,'node_modules',`opencode-darwin-${process.arch}`,'bin','opencode');}
function masterKey(dir){
 if(!safeStorage.isEncryptionAvailable())throw Error('系统钥匙串不可用，无法安全保存代理密钥。请解锁 macOS 钥匙串后重试。');
 const path=join(dir,'vault-key.bin');
 if(existsSync(path))return safeStorage.decryptString(readFileSync(path));
 const key=randomBytes(32).toString('base64');writeFileSync(path,safeStorage.encryptString(key),{mode:0o600});return key;
}
function trusted(event){if(!base||event.sender!==window?.webContents||!event.senderFrame?.url.startsWith(base+'/'))throw Error('Untrusted frame');}
ipcMain.handle('gfot:folder',async event=>{trusted(event);const result=await dialog.showOpenDialog(window,{title:'选择项目目录',properties:['openDirectory','createDirectory']});return result.canceled?null:result.filePaths[0];});
async function serviceCall(path,input){
 const response=await fetch(base+'/api/'+path,{method:'POST',headers:{authorization:'Bearer '+worker.auth,'content-type':'application/json'},body:JSON.stringify(input)});
 const data=await response.json();if(!response.ok)throw Error(data.error||'本地账号操作失败');return data;
}
ipcMain.handle('gfot:import-codex',async event=>{
 trusted(event);const result=await dialog.showOpenDialog(window,{title:'选择你授权 gfot 导入的 Codex auth.json（不修改原文件）',defaultPath:join(app.getPath('home'),'.codex','auth.json'),properties:['openFile','showHiddenFiles'],filters:[{name:'JSON credential file',extensions:['json']}]});
 if(result.canceled)return null;const path=result.filePaths[0];if(statSync(path).size>90000)throw Error('凭证文件过大，拒绝导入');
 return serviceCall('accounts/import',{document:readFileSync(path,'utf8')});
});
ipcMain.handle('gfot:chatgpt-login',async(event,accountId)=>{
 trusted(event);const result=await serviceCall('accounts/login/start',{...(typeof accountId==='string'?{accountId}:{})});
 const url=new URL(result.authorizationURL);if(url.origin!=='https://auth.openai.com'||url.pathname!=='/api/accounts/authorize')throw Error('不可信的授权地址');
 try{await shell.openExternal(url.href);}catch{await serviceCall('accounts/login/cancel',{id:result.id});throw Error('无法打开浏览器，请重试');}
 return {id:result.id};
});

function createWindow(){
 window=new BrowserWindow({width:1240,height:820,minWidth:840,minHeight:600,title:'gfot',backgroundColor:'#ffffff',titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:20},webPreferences:{preload:join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(base+'/'))event.preventDefault();});
 window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
 window.loadURL(base+'/',{extraHeaders:'Authorization: Bearer '+worker.auth+'\n'});
 window.on('closed',()=>{window=null;});
}
async function boot(){
 const dir=app.getPath('userData');mkdirSync(dir,{recursive:true,mode:0o700});
 const key=masterKey(dir),binary=engineBinary();if(!existsSync(binary))throw Error('内置执行器缺失，请重新安装 gfot。');
 worker=utilityProcess.fork(join(__dirname,'worker.mjs'),[],{stdio:'pipe',serviceName:'gfot local service'});
 worker.stderr.on('data',()=>{});worker.stdout.on('data',()=>{});
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('本地服务启动超时')),15000);worker.on('message',message=>{if(message.type==='ready'){clearTimeout(timeout);base=message.url;worker.auth=message.auth;resolve();}else if(message.type==='failed'){clearTimeout(timeout);reject(Error('无法打开本机数据，请检查数据目录和钥匙串。'));}});worker.once('exit',()=>{clearTimeout(timeout);reject(Error('本地服务已退出'));if(!quitting){dialog.showErrorBox('gfot 服务已停止','请重新打开应用。未完成的任务会标记为中断。');app.quit();}});worker.once('spawn',()=>worker.postMessage({type:'start',dataDir:dir,binary,key,harnessRunner:app.isPackaged?join(process.resourcesPath,'harness2','h2-runner.py'):join(__dirname,'h2-runner.py')}));});
 createWindow();
}
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();else{
 app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
 app.whenReady().then(()=>{Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'gfot',submenu:[{role:'about'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}]));return boot();}).catch(error=>{dialog.showErrorBox('gfot 无法启动',error.message);app.quit();});
 app.on('activate',()=>{if(!window&&base)createWindow();});
 app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;if(worker){worker.postMessage({type:'stop'});worker.once('exit',()=>app.exit(0));setTimeout(()=>{worker.kill();app.exit(0);},4000);}else app.exit(0);});
}
