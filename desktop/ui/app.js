const $=s=>document.querySelector(s);
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={tasks:[],profiles:[],accounts:[]},selected=localStorage.getItem('gfot-task'),rendered=null,messageSignature='',approvalSignature='';
const labels={idle:'等待任务',starting:'启动中',running:'执行中',permission:'等待确认',error:'执行出错',stopped:'已停止',interrupted:'上次执行中断'};
const busy=task=>task&&['starting','running','permission'].includes(task.status);
async function api(path,body){const r=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'请求失败');return data;}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';setTimeout(()=>$('#toast').style.display='none',5500);}
function modal(title,description,content,submit,onSubmit){
 $('#dialog-body').innerHTML=`<h2>${escape(title)}</h2><p>${escape(description)}</p><form id="modal-form">${content}<div id="dialog-error" role="alert"></div><div class="actions"><button type="button" id="modal-close">取消</button><button class="primary" type="submit">${escape(submit)}</button></div></form>`;
 if(!$('#dialog').open)$('#dialog').showModal();$('#modal-close').onclick=()=>$('#dialog').close();
 $('#modal-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;try{await onSubmit(Object.fromEntries(new FormData(event.target)),event.target);}catch(error){if(event.target.isConnected)$('#dialog-error').textContent=error.message;}finally{button.disabled=false;}};
}
function field(name,label,value='',type='text',placeholder=''){return `<label>${escape(label)}<input name="${name}" type="${type}" value="${escape(value)}" placeholder="${escape(placeholder)}" ${type==='password'?'autocomplete="new-password"':'required'}></label>`;}
const presets={
 custom:{label:'自定义 HTTPS API',mode:'direct',baseURL:'',model:''},
 deepseek:{label:'DeepSeek API',mode:'direct',baseURL:'https://api.deepseek.com',model:''},
 ollama:{label:'本机 Ollama',mode:'local',baseURL:'http://127.0.0.1:11434/v1',model:''},
 proxy:{label:'本机模型代理',mode:'local',baseURL:'http://127.0.0.1:8080/v1',model:''},
 ccswitch:{label:'CC Switch Codex 路由',mode:'local',baseURL:'http://127.0.0.1:15721/v1',model:'',protocol:'responses'},
 ccswitchClaude:{label:'CC Switch Claude 路由',mode:'local',baseURL:'http://127.0.0.1:15721/v1',model:'',protocol:'anthropic'},
};
function editProfile(profile,after){
 if(profile?.mode==='account')return bindAccount(state.accounts.find(a=>a.id===profile.accountId),profile,after);
 const mode=profile?.mode||'local';
 modal(profile?'编辑模型连接':'连接你的模型','支持 OpenAI Chat Completions 兼容服务。API 直连无需另外安装代理；API Key 与订阅登录凭证不同。',
 `<label>快速填写<select id="connection-preset"><option value="existing">${profile?'保留当前配置':'选择服务…'}</option>${Object.entries(presets).map(([id,p])=>`<option value="${id}">${escape(p.label)}</option>`).join('')}</select></label>`+
 `<label>连接方式<select name="mode"><option value="local" ${mode==='local'?'selected':''}>本机服务（HTTP 回环地址）</option><option value="direct" ${mode==='direct'?'selected':''}>HTTPS API 直连（使用自己的 API Key）</option></select></label>`+
 `<label>接口协议<select name="protocol"><option value="chat" ${(profile?.protocol||'chat')==='chat'?'selected':''}>OpenAI Chat Completions</option><option value="responses" ${profile?.protocol==='responses'?'selected':''}>OpenAI Responses（含 Codex 反代）</option><option value="anthropic" ${profile?.protocol==='anthropic'?'selected':''}>Anthropic Messages（含 Claude 路由）</option></select></label>`+
 field('label','连接名称',profile?.label||'我的模型')+field('baseURL','Base URL',profile?.baseURL||'','url','如 https://your-service.example/v1')+
 field('apiKey',profile?.hasKey?'访问密钥（留空保留，钥匙串保护）':'API Key（本机服务不要求时可留空）','','password')+
 (profile?.hasKey?'<label class="check"><input type="checkbox" name="clearKey" value="yes">清除旧密钥（HTTPS 直连需重新填写）</label>':'')+
 `<div class="model-discovery"><button id="load-models" type="button">读取模型列表</button><span id="model-discovery-note">也可以手动填写模型 ID</span></div>`+
 field('model','模型 ID',profile?.model||'','text','选择支持工具调用的模型')+'<datalist id="available-models"></datalist>',
 '保存连接',async(values,form)=>{state=await api('profiles',{...values,clearKey:values.clearKey==='yes',...(profile?{id:profile.id}:{})});render();if(form.isConnected&&$('#modal-form')===form){$('#dialog').close();if(after)await after();}});
 const form=$('#modal-form'),model=form.elements.model;model.setAttribute('list','available-models');
 $('#connection-preset').onchange=event=>{const p=presets[event.target.value];if(!p)return;for(const field of ['mode','label','baseURL','model'])form.elements[field].value=p[field];form.elements.protocol.value=p.protocol||'chat';form.elements.apiKey.value='';if(form.elements.clearKey)form.elements.clearKey.checked=true;$('#available-models').innerHTML='';$('#model-discovery-note').textContent='请核对服务显示的地址和密钥，再读取模型列表';};
 $('#load-models').onclick=async event=>{const button=event.target;button.disabled=true;$('#dialog-error').textContent='';try{
  const values=Object.fromEntries(new FormData(form)),snapshot=JSON.stringify(values);const result=await api('connections/models',{...values,clearKey:values.clearKey==='yes',...(profile?{id:profile.id}:{})});
  if(!form.isConnected||$('#modal-form')!==form)return;if(JSON.stringify(Object.fromEntries(new FormData(form)))!==snapshot){$('#model-discovery-note').textContent='配置已变化，请重新读取模型列表';return;}
  $('#available-models').innerHTML=result.models.map(id=>`<option value="${escape(id)}"></option>`).join('');
  if(!model.value&&result.models.length===1)model.value=result.models[0];
  $('#model-discovery-note').textContent=result.models.length?'找到 '+result.models.length+' 个模型，点击模型输入框选择':'模型列表为空；请先在服务端准备模型';model.focus();
 }catch(error){if(form.isConnected&&$('#modal-form')===form)$('#dialog-error').textContent=error.message;}finally{button.disabled=false;}};
}
const agentName=id=>state.agents?.find(a=>a.id===id)?.name||id||'OpenCode';
const availableAgents=()=>state.agents?.filter(a=>a.available&&a.kind!=='unavailable')||[{id:'opencode',name:'OpenCode · 内置',kind:'builtin'}];
function agentCards(){return `<h3 class="connection-title">本机 Agent</h3><p>直接运行本机执行器，使用它自己的登录与默认模型。协议检查不会发送推理请求。</p><div class="agent-cards">${(state.agents||[]).map(a=>`<div class="agent-card"><div><strong>${escape(a.name)}</strong><small>${escape(a.description)}</small><small>${a.kind==='builtin'?'已内置 · 使用下方模型连接':!a.installed?'未安装':a.kind==='unavailable'?'已安装 · 执行接口未接入':a.check?.connected?'协议已连接 · 实际执行以任务结果为准':'已发现 · 待检查'}${a.check?.connected===false?' · 上次检查失败':''}</small>${a.login?`<small>${escape(a.login.note)}</small>`:''}</div><div class="agent-card-actions">${['workbuddy','workbuddy-ai'].includes(a.id)&&a.available?`<button type="button" data-login-agent="${a.id}" ${a.login?.status==='pending'?'disabled':''}>登录 CLI</button>`:''}${a.login?.status==='pending'?`<button type="button" data-cancel-agent-login="${a.login.id}">取消登录</button>`:''}${a.kind==='acp'&&a.available?`<button type="button" data-check-agent="${a.id}">检查连接</button>`:''}${a.installed&&a.kind==='acp'?`<button type="button" data-open-agent="${a.id}">打开应用</button>`:''}</div></div>`).join('')}</div><button type="button" id="refresh-agents">重新检测</button>`;}
async function editTaskNotes(){const task=state.tasks.find(t=>t.id===selected);if(!task||busy(task))return;
 modal('任务记忆','记录目标、约束与交接要点。备注随后续消息发送给所选 Agent；切换时同时传递最多 60000 字符的近期可见对话，不包含其他客户端的私有历史。',`<label>共享任务备注<textarea name="text" rows="8" maxlength="8000">${escape(task.contextNotes||'')}</textarea></label>`,'保存',async values=>{state=await api('tasks/'+task.id+'/notes',{text:values.text});$('#dialog').close();render();});
}
function settings(){
 const accountRows=(state.accounts||[]).map(a=>`<div class="profile-row account-row"><div><strong>${escape(a.label)}</strong><small>${a.source==='chatgpt'?'ChatGPT 独立授权':'Codex 本地凭证副本'} · ${escape(a.status)}</small><small>${a.expiresAt?'访问凭证到期：'+escape(new Date(a.expiresAt).toLocaleString()):''}</small><small>${a.inferenceAt?'✓ 曾完成推理 · '+escape(new Date(a.inferenceAt).toLocaleString()):'仅有凭证，尚未验证推理'}</small></div><div class="account-actions"><button data-use-account="${a.id}">选模型</button><button data-quota-account="${a.id}">查额度</button>${a.source==='chatgpt'?`<button data-login-account="${a.id}">重新登录</button>`:''}${a.hasCredentials?`<button data-logout-account="${a.id}">退出</button>`:''}</div></div>`).join('');
 $('#dialog-body').innerHTML=`<h2>Agent 与账号</h2>${agentCards()}<h3 class="connection-title">内置 OpenCode 的模型与账号</h3><p>下列连接供内置执行器使用。本机 Agent 使用各自的账号配置。</p><p class="experimental-note">订阅账号接入为实验功能。Codex 导入已做单账号诊断，独立 ChatGPT 登录仍待真实验收；兼容接口可能随上游变化失效。</p><p>账号凭证在本机加密保存。导入 Codex 只复制访问凭证，不修改原文件，也不轮换共享刷新凭证。独立登录的续期由 gfot 管理。</p><div class="account-entry"><button id="login-chatgpt">Continue with ChatGPT</button><button id="import-codex">导入 Codex 登录</button></div>${accountRows||'<p>尚未添加订阅账号。</p>'}<h3 class="connection-title">任务使用的连接</h3><p>同一任务可在回合之间切换账号连接或 API 连接；遇到限额不会自动重放已经执行的操作。</p>${state.profiles.map(p=>`<div class="profile-row"><div>${escape(p.label)}<small>${p.mode==='account'?'订阅账号':p.mode==='direct'?'HTTPS API':'本机服务'} · ${escape(p.model)}</small><small>${p.verification?.toolCalling?'✓ 推理与工具回传已检查（'+escape(new Date(p.verification.at).toLocaleDateString())+'）':'尚未完成推理与工具检查'}</small></div><div><button data-verify-profile="${p.id}">验证可用性</button> <button data-edit-profile="${p.id}">编辑</button></div></div>`).join('')||'<p>从账号选择模型，或添加 API / CC Switch 本机路由。</p>'}<div class="actions"><button id="settings-close">关闭</button><button class="primary" id="add-profile">添加 API / 代理</button></div>`;
 if(!$('#dialog').open)$('#dialog').showModal();$('#settings-close').onclick=()=>$('#dialog').close();$('#refresh-agents').onclick=async()=>{try{state=await api('agents/refresh',{});settings();render();}catch(e){toast(e.message);}};$('#add-profile').onclick=()=>editProfile();
 $('#login-chatgpt').onclick=()=>loginAccount().catch(e=>toast(e.message));$('#import-codex').onclick=async()=>{try{
  if(!window.gfotDesktop?.importCodex)throw Error('凭证导入需要 macOS 原生客户端');const result=await gfotDesktop.importCodex();if(!result)return;state=await api('state');render();bindAccount(state.accounts.find(a=>a.id===result.accountId));
 }catch(error){toast(error.message);}};
}
async function loginAccount(accountId){
 if(!window.gfotDesktop?.loginChatGPT)return toast('请在 macOS 客户端登录');
 const {id}=await gfotDesktop.loginChatGPT(accountId);
 $('#dialog-body').innerHTML='<h2>在浏览器中完成登录</h2><p>请确认是 OpenAI 的授权页面。gfot 使用自己的注册与回调，授权结果只保存在本机。</p><div id="login-progress" role="status">等待浏览器授权…</div><div class="actions"><button id="cancel-login">取消登录</button></div>';
 if(!$('#dialog').open)$('#dialog').showModal();const progress=$('#login-progress');
 $('#cancel-login').onclick=()=>{$('#dialog').close();void api('accounts/login/cancel',{id});};
 for(let i=0;i<600;i++){
  if(!progress.isConnected||!$('#dialog').open){await api('accounts/login/cancel',{id});return;}
  const result=await api('accounts/login/status',{id});
  if(result.status==='complete'){state=await api('state');render();return bindAccount(state.accounts.find(a=>a.id===result.accountId));}
  if(result.status!=='pending'){progress.textContent=result.error||'登录已取消';return;}
  await new Promise(resolve=>setTimeout(resolve,1500));
 }
}
function bindAccount(account,profile,after){
 if(!account)return toast('账号不存在，请重新选择');
 modal('选择订阅模型',account.source==='codex-local'?'使用你明确导入的 Codex 访问凭证。读取模型目录、查询额度和推理是不同检查；过期后需重新导入或独立登录。':'使用所选 ChatGPT 注册的订阅权限。选择模型后可检查推理；该登录不会重置或增加账号限额。',
 `<p><strong>${escape(account.label)}</strong></p>`+field('label','连接名称',profile?.label||account.label)+`<button type="button" id="load-account-models">读取该账号的模型</button><span id="account-model-note"></span>`+field('model','模型 ID',profile?.model||'','text','从当前账号目录选择或手动填写')+'<datalist id="account-models"></datalist>',
 '保存账号连接',async(values,form)=>{state=await api('profiles',{...values,mode:'account',accountId:account.id,...(profile?{id:profile.id}:{})});render();if(form.isConnected){$('#dialog').close();if(after)await after();}});
 const form=$('#modal-form');form.elements.model.setAttribute('list','account-models');
 $('#load-account-models').onclick=async event=>{event.target.disabled=true;try{const result=await api('accounts/models',{id:account.id});if(!form.isConnected)return;$('#account-models').innerHTML=result.models.map(id=>`<option value="${escape(id)}"></option>`).join('');$('#account-model-note').textContent='找到 '+result.models.length+' 个模型；目录不代表已验证推理';if(result.models.length===1&&!form.elements.model.value)form.elements.model.value=result.models[0];form.elements.model.focus();}catch(error){if(form.isConnected)$('#dialog-error').textContent=error.message;}finally{event.target.disabled=false;}};
}

function verifyProfile(profile){
 modal('验证模型是否可用','检查会向所选服务发送最多两次固定诊断请求，可能消耗你的模型用量。不会读取项目、执行命令或修改文件。',`<p><strong>${escape(profile.label)}</strong> · ${escape(profile.model)}<br>${escape(profile.baseURL)}</p><label class="check"><input type="checkbox" required>我同意发送诊断消息并使用该服务的模型额度</label><div id="verification-result" role="status"></div>`,'开始检查',async(_values,form)=>{
  $('#verification-result').textContent='正在检查模型推理、工具调用与结果回传…';
  const result=await api('profiles/verify',{id:profile.id,consent:true});state=await api('state');if(!form.isConnected||$('#modal-form')!==form)return;
  $('#verification-result').textContent=result.note;$('#modal-form button[type=submit]').textContent='重新检查';render();
 });
}

async function createTask(){
 if(!availableAgents().length){settings();return;}
 let folder='';if(window.gfotDesktop){folder=await window.gfotDesktop.chooseFolder();if(!folder)return;}
 modal('新建项目任务','目录内的相关内容可能发送到你选择的模型服务。每个任务单独保存会话；工具权限不是操作系统沙箱。',`<label>本地项目目录<div class="folder-choice"><input name="folder" required value="${escape(folder)}" placeholder="/Users/you/project"><button type="button" id="choose-folder">选择…</button></div></label>${field('title','任务名称',folder.split('/').pop()||'新任务')}<label>执行 Agent<select name="agentId">${availableAgents().filter(a=>a.kind!=='builtin'||state.profiles.length).map(a=>`<option value="${a.id}">${escape(a.name)}</option>`).join('')}</select></label><label>内置执行器的模型连接<select name="profileId">${state.profiles.map(p=>`<option value="${p.id}">${escape(p.label)} · ${escape(p.model)}</option>`).join('')}</select></label><label class="check"><input type="checkbox" required>我允许所选 Agent 及其模型服务处理此项目的相关内容；修改文件和运行命令需另行确认。</label>`,'创建任务',async values=>{const {taskId}=await api('tasks',values);selected=taskId;localStorage.setItem('gfot-task',selected);state=await api('state');$('#dialog').close();render();$('#prompt').focus();});
 $('#choose-folder').onclick=async()=>{if(!window.gfotDesktop)return toast('浏览器预览请手工填写目录；桌面应用支持原生目录选择。');const path=await window.gfotDesktop.chooseFolder();if(path)document.querySelector('[name=folder]').value=path;};
}
function optimizeHarness(){
 const task=state.tasks.find(t=>t.id===selected);if(!task||busy(task))return;
 if(!state.harness2?.available)return toast(state.harness2?.reason||'需要 Python 3.12 / 3.13');
 modal('Harness² 提示词优化','运行真实 Harness² Propose–Probe–Compose，深度 k=1。四次副本探测、三个配置阶段；含重试最多十次执行器会话，可能产生多次模型费用。',
 `<p>读取项目文本快照（最多 200 文件 / 2 MB），排除隐藏文件、链接、依赖、构建产物和常见凭证文件名。探测在副本中执行；生成的代码不会自动写回原项目。工具审批不是操作系统沙箱。</p>`+
 `<p>优化系统提示词、执行约束、任务记忆与工具指引四项指令。使用内置 OpenCode 与当前连接完成副本探测，不修改审批权限；采用后的指令也会随任务发送给其他 Agent。</p>`+
 `<label>需要优化的任务<textarea name="text" required rows="4">${escape($('#prompt').value||'')}</textarea></label><label class="check"><input type="checkbox" required>允许发送副本文本并使用所选模型进行最多十次执行器会话；工具操作仍需审批。</label>`,
 '开始优化',async values=>{await api('tasks/'+selected+'/harness',{text:values.text,profileId:$('#profile-select').value,consent:true});$('#dialog').close();state=await api('state');render();});
}
function renderHarness(task){
 const run=task.harnessRun,box=$('#h2-report');box.hidden=!run&&!task.adoptedHarness;if(box.hidden)return;
 const result=run?.result,ledger=result?.method?.ledger;
 box.innerHTML=`<h3>Harness²</h3><p>${task.adoptedHarness?'已采用配置 · 作用于本任务后续普通执行':'配置需单独确认，不自动写回项目代码'}</p>`+
 (run?`<p>${escape(run.status)}${run.phase?' · '+escape(run.phase.label):''}</p>`:'')+
 (ledger?`<p>探测 ${ledger.R} 次 · 配置阶段 ${ledger.P} 次</p><p>费用数据未接入，账本中的 USD 0 不表示免费。</p>`:'')+
 (result?`<details class="prompt-preview" open><summary>优化后的系统提示词</summary><pre>${escape(result.harness?.['systemprompt.md']||'')}</pre><button type="button" id="h2-copy-prompt">复制提示词</button></details><details><summary>候选执行证据</summary><pre>${escape(JSON.stringify(result.candidates,null,2))}</pre></details><details><summary>合成配置与阶段说明</summary><pre>${escape(JSON.stringify({harness:result.harness,stages:result.method?.stages},null,2))}</pre></details><details><summary>合成候选回答（源项目未应用）</summary><pre>${escape(result.answer||'')}</pre></details>`:'')+
 (run?.status==='ready'&&!busy(task)?'<button type="button" id="h2-adopt">确认采用配置</button>':'')+
 (task.adoptedHarness&&!busy(task)?'<button type="button" id="h2-clear">恢复默认配置</button>':'');
 const copy=$('#h2-copy-prompt');if(copy)copy.onclick=async()=>{try{const text=result.harness['systemprompt.md'];if(window.gfotDesktop?.copyText)await window.gfotDesktop.copyText(text);else await navigator.clipboard.writeText(text);toast('已复制优化后的系统提示词');}catch(e){toast(e.message);}};
 const adopt=$('#h2-adopt');if(adopt)adopt.onclick=async()=>{try{state=await api('tasks/'+task.id+'/harness-adopt',{runId:run.runId,consent:true});render();}catch(e){toast(e.message);}};
 const clear=$('#h2-clear');if(clear)clear.onclick=async()=>{try{state=await api('tasks/'+task.id+'/harness-clear',{});render();}catch(e){toast(e.message);}};
}
function render(){
 $('#task-list').innerHTML=state.tasks.map(t=>`<button class="task-item ${t.id===selected?'active':''}" data-task="${t.id}"><strong>${escape(t.title)}</strong><small>${escape(t.folder.split('/').pop())} · ${labels[t.status]||t.status}</small></button>`).join('')||'<p class="section-label">还没有项目任务</p>';
 $('#connection-dot').classList.toggle('ready',state.profiles.length>0);
 const task=state.tasks.find(t=>t.id===selected);$('#welcome').hidden=!!task;$('#workspace').hidden=!task;$('#breadcrumb').textContent=task?'工作区 / '+task.title:'工作区';if(!task)return;
 const agentId=task.agentId||'opencode';
 const agentOptions=availableAgents().map(a=>`<option value="${a.id}">${escape(a.name)}</option>`).join('');if($('#agent-select').innerHTML!==agentOptions)$('#agent-select').innerHTML=agentOptions;$('#agent-select').value=agentId;$('#agent-select').disabled=busy(task);$('#task-notes').disabled=busy(task);
 $('#profile-select').hidden=agentId!=='opencode';$('#execution-label').textContent=agentId==='opencode'?'模型连接':'使用 Agent 自己的账号';
 $('#runtime-note').textContent='执行器：'+agentName(agentId)+'\n任务备注：'+(task.contextNotes?'已保存':'未设置')+'\n切换时共享近期可见对话\n额度不足时请停止后切换';
 renderHarness(task);$('#h2-optimize').disabled=busy(task)||!state.harness2?.available||agentId!=='opencode';$('#h2-optimize').title=agentId!=='opencode'?'请先选择内置 OpenCode 和模型连接进行提示词优化':state.harness2?.reason||'四次副本探测后合成提示词与执行配置';
 $('#task-title').textContent=task.title;$('#folder-label').textContent='⌁ '+task.folder;$('#status').textContent=labels[task.status]||task.status;
 const options=state.profiles.map(p=>`<option value="${p.id}">${escape(p.label)} · ${escape(p.model)}</option>`).join('');if($('#profile-select').innerHTML!==options){const chosen=$('#profile-select').value||task.profileId;$('#profile-select').innerHTML=options;$('#profile-select').value=state.profiles.some(p=>p.id===chosen)?chosen:task.profileId;}
 if(rendered!==selected){rendered=selected;$('#profile-select').value=task.profileId;$('#prompt').value='';messageSignature='';}
 $('#profile-select').disabled=busy(task);$('#prompt').disabled=busy(task);$('#send').hidden=busy(task);$('#stop').hidden=!busy(task);$('#send').disabled=agentId==='opencode'&&!state.profiles.length;
 const signature=JSON.stringify([task.messages,task.draft]);if(signature!==messageSignature){messageSignature=signature;$('#messages').innerHTML=task.messages.map(m=>`<article class="message ${m.role}"><div class="role">${m.role==='user'?'YOU':agentName(m.agentId||'opencode')}</div><div class="text">${escape(m.text)}</div></article>`).join('')+(task.draft?`<article class="message draft"><div class="role">正在生成</div><div class="text">${escape(task.draft)}</div></article>`:'')||'<div class="session-empty">项目已就绪。描述目标，开始第一个任务。</div>';$('#messages').scrollTop=$('#messages').scrollHeight;}
 $('#task-error').textContent=task.error||'';$('#event-count').textContent=task.events.length;
 $('#events').innerHTML=task.events.slice().reverse().map(e=>`<details><summary>${escape(e.text)}</summary><pre>${escape(e.detail||new Date(e.at).toLocaleTimeString())}</pre></details>`).join('');
 const approvals=JSON.stringify([selected,task.pending]);if(approvals!==approvalSignature){approvalSignature=approvals;$('#approvals').innerHTML=task.pending.map(p=>p.kind==='permission'?`<div class="approval"><strong>需要批准：${escape(p.permission||p.type||'工具操作')}</strong><pre>${escape(JSON.stringify(p.patterns||p.metadata||{},null,2))}</pre><div class="actions"><button data-permission="${p.id}" data-reply="reject">拒绝</button><button data-permission="${p.id}" data-reply="once">批准一次</button></div></div>`:`<form class="approval question-form" data-question="${p.id}"><strong>请回答执行器的问题</strong>${(p.questions||[]).map((q,i)=>`<label>${escape(q.question||q.header)}<input name="q${i}" placeholder="${escape((q.options||[]).map(o=>o.label).join(' / '))}" required></label>`).join('')}<button type="submit">提交回答</button></form>`).join('');}
}
$('#agent-select').onchange=async()=>{try{state=await api('tasks/'+selected+'/agent',{agentId:$('#agent-select').value});render();}catch(e){toast(e.message);render();}};
$('#task-notes').onclick=editTaskNotes;
$('#h2-optimize').onclick=optimizeHarness;
$('#settings').onclick=settings;$('#new-task').onclick=()=>createTask().catch(e=>toast(e.message));$('#welcome-new').onclick=$('#new-task').onclick;
$('#composer').onsubmit=async event=>{event.preventDefault();const text=$('#prompt').value.trim();if(!text)return;const button=$('#send');button.disabled=true;try{await api('tasks/'+selected+'/prompt',{text,profileId:$('#profile-select').value});$('#prompt').value='';state=await api('state');render();}catch(e){toast(e.message);}finally{button.disabled=false;}};
$('#prompt').onkeydown=event=>{if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();$('#composer').requestSubmit();}};
$('#stop').onclick=()=>api('tasks/'+selected+'/stop',{}).catch(e=>toast(e.message));
document.addEventListener('keydown',event=>{if(event.metaKey&&event.key==='n'){event.preventDefault();void createTask();}});
document.addEventListener('click',async event=>{const t=event.target.closest('[data-task]');if(t){selected=t.dataset.task;localStorage.setItem('gfot-task',selected);render();return;}const nativeLogin=event.target.closest('[data-login-agent]');if(nativeLogin){try{if(!window.gfotDesktop?.loginAgent)throw Error('请使用桌面客户端登录');nativeLogin.disabled=true;await window.gfotDesktop.loginAgent(nativeLogin.dataset.loginAgent);state=await api('state');settings();render();}catch(e){nativeLogin.disabled=false;toast(e.message);}return;}const cancelLogin=event.target.closest('[data-cancel-agent-login]');if(cancelLogin){try{await api('agents/login/cancel',{id:cancelLogin.dataset.cancelAgentLogin});state=await api('state');settings();}catch(e){toast(e.message);}return;}const checkAgent=event.target.closest('[data-check-agent]');if(checkAgent){checkAgent.disabled=true;try{const r=await api('agents/check',{id:checkAgent.dataset.checkAgent});state=await api('state');settings();render();toast(r.note);}catch(e){toast(e.message);}finally{checkAgent.disabled=false;}return;}const openAgent=event.target.closest('[data-open-agent]');if(openAgent){try{if(!window.gfotDesktop?.openAgent)throw Error('请从桌面客户端打开 Agent');await window.gfotDesktop.openAgent(openAgent.dataset.openAgent);}catch(e){toast(e.message);}return;}const use=event.target.closest('[data-use-account]');if(use)return bindAccount(state.accounts.find(a=>a.id===use.dataset.useAccount));const login=event.target.closest('[data-login-account]');if(login)return loginAccount(login.dataset.loginAccount).catch(e=>toast(e.message));const quota=event.target.closest('[data-quota-account]');if(quota){quota.disabled=true;try{const q=await api('accounts/quota',{id:quota.dataset.quotaAccount});toast(q.supported?[q.primary,q.secondary].filter(Boolean).map(w=>'已使用 '+w.usedPercent+'%'+(w.resetAt?'，重置 '+new Date(w.resetAt*1000).toLocaleString():'')).join(' / '):q.note);}catch(e){toast(e.message);}finally{quota.disabled=false;}return;}const logout=event.target.closest('[data-logout-account]');if(logout){logout.disabled=true;try{const result=await api('accounts/logout',{id:logout.dataset.logoutAccount});state=await api('state');settings();render();toast(result.note);}catch(e){toast(e.message);logout.disabled=false;}return;}const edit=event.target.closest('[data-edit-profile]');if(edit)return editProfile(state.profiles.find(p=>p.id===edit.dataset.editProfile));const verify=event.target.closest('[data-verify-profile]');if(verify)return verifyProfile(state.profiles.find(p=>p.id===verify.dataset.verifyProfile));const test=event.target.closest('[data-test-profile]');if(test){test.disabled=true;try{const result=await api('profiles/test',{id:test.dataset.testProfile});toast(result.modelListed?'代理可达，模型在列表中；推理与工具调用尚需实际验证。':'代理可达，模型未在列表中。请核对模型 ID。');}catch(e){toast(e.message);}finally{test.disabled=false;}return;}const p=event.target.closest('[data-permission]');if(p){p.disabled=true;try{await api('tasks/'+selected+'/permission',{id:p.dataset.permission,reply:p.dataset.reply});}catch(e){toast(e.message);}finally{p.disabled=false;}return;}});
document.addEventListener('submit',async event=>{if(!event.target.matches('.question-form'))return;event.preventDefault();try{const values=Object.values(Object.fromEntries(new FormData(event.target)));await api('tasks/'+selected+'/question',{id:event.target.dataset.question,answers:values.map(v=>[v])});}catch(e){toast(e.message);}});
try{state=await api('state');render();const events=new EventSource('/api/events');events.addEventListener('state',event=>{const previous=JSON.stringify(state.agents?.map(a=>a.login));state=JSON.parse(event.data);render();if($('#refresh-agents')&&previous!==JSON.stringify(state.agents?.map(a=>a.login)))settings();});events.onerror=()=>{$('#status').textContent='本地服务连接中断';};}catch(error){toast('加载失败：'+error.message);}
