import {html} from './render.js';
const date=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString():'未知';};
export function accountStatus(account,now=Date.now()){
 if(!account.hasCredentials||account.status==='signed-out')return {label:'已退出',tone:'muted'};
 if(account.status==='reauth-required')return {label:'需要重新登录',tone:'warning'};
 if(account.status==='expired'||Number.isFinite(account.expiresAt)&&account.expiresAt<=now)return {label:account.canRefresh?'需要续期':'需要重新导入',tone:'warning'};
 return {label:'凭证已保存',tone:'ready'};
}
export function quotaWindows(quota,now=Date.now()){
 if(!quota?.supported)return '<p class="quota-note">尚无可用额度记录</p>';
 const windows=[['主要窗口',quota.primary],['次要窗口',quota.secondary]].filter(([,w])=>Number.isFinite(w?.usedPercent));
 if(!windows.length)return '<p class="quota-note">额度数据不可用，不代表余额为零。</p>';
 return windows.map(([fallback,w])=>{
  const remaining=Math.round((100-Math.min(100,Math.max(0,w.usedPercent)))*10)/10;
  const label=w.windowSeconds===18000?'5 小时额度':w.windowSeconds===604800?'每周额度':Number.isFinite(w.windowSeconds)&&w.windowSeconds>0?Math.round(w.windowSeconds/3600*10)/10+' 小时窗口':fallback;
  const reset=Number.isFinite(w.resetAt)&&w.resetAt>0;
  return `<div class="quota-window"><div><span>${html(label)}</span><strong>剩余 ${remaining}%</strong></div><meter min="0" max="100" value="${remaining}" aria-label="${html(label)}剩余 ${remaining}%"></meter><small>${reset?(w.resetAt*1000<=now?'已到重置时间，请刷新':'重置：'+html(date(w.resetAt*1000))):'重置时间未提供'}</small></div>`;
 }).join('');
}
export function quotaOverview(state,{pending=new Set(),errors=new Map(),now=Date.now()}={}){
 const accounts=state.accounts||[],native=(state.agents||[]).filter(a=>a.kind!=='builtin'),profiles=(state.profiles||[]).filter(p=>p.mode!=='account');
 return `<div class="quota-intro"><span class="eyebrow">ACCOUNTS & USAGE</span><h2>账号与额度</h2><p>查看账号凭证状态和服务提供的额度。订阅额度以用量窗口展示，不等于可消费的 Token 数或现金余额。</p></div><div class="quota-summary"><span>订阅账号 <strong>${accounts.length}</strong></span><span>已发现本机 Agent <strong>${native.filter(a=>a.installed).length}</strong></span><span>API / 本机连接 <strong>${profiles.length}</strong></span></div><h3>订阅账号</h3><div class="quota-grid">${accounts.map(a=>{
  const status=accountStatus(a,now),supported=a.source==='codex-local',loading=pending.has(a.id),error=errors.get(a.id);
  return `<article class="quota-card" data-quota-card="${html(a.id)}"><div class="quota-card-heading"><div><strong>${html(a.label)}</strong><small>${a.source==='codex-local'?'Codex 导入账号':'ChatGPT 独立授权'}</small></div><span class="quota-badge ${status.tone}">${status.label}</span></div>${a.expiresAt?`<p class="quota-note">访问凭证到期：${html(date(a.expiresAt))}${a.canRefresh?' · 支持续期':''}</p>`:''}<p class="quota-note">${a.inferenceAt?'最近推理成功：'+html(date(a.inferenceAt)):'尚未验证推理；凭证存在不代表模型可用。'}</p>${supported?quotaWindows(a.quota,now):'<p class="quota-note">此授权方式暂不支持额度查询。</p>'}${a.quota?.checkedAt?`<small class="quota-timestamp">${a.hasCredentials?'上次查询':'历史记录'}：${html(date(a.quota.checkedAt))} · 非实时余额</small>`:''}${error?`<p class="quota-error" role="alert">${html(error)}${a.quota?'；上方保留上次查询记录。':''}</p>`:''}<div class="quota-actions">${supported?`<button type="button" data-refresh-quota="${html(a.id)}" ${loading||!a.hasCredentials?'disabled':''}>${loading?'正在查询…':'刷新额度'}</button>`:''}${a.source==='chatgpt'?`<button type="button" data-login-account="${html(a.id)}">重新登录</button>`:''}</div></article>`;
 }).join('')||'<p class="quota-empty">还没有添加订阅账号。通过“管理账号与连接”导入或登录。</p>'}</div><h3>本机 Agent</h3><div class="quota-grid">${native.map(a=>`<article class="quota-card"><div class="quota-card-heading"><strong>${html(a.name)}</strong><span class="quota-badge muted">${!a.installed?'未安装':a.kind==='unavailable'?'尚未接入执行':a.check?.connected?'曾通过连接检查':'已发现'}</span></div><p class="quota-note">${a.installed?'账号由原 Agent 管理，gfot 尚不能查询其登录有效期或剩余额度。':'安装后可在 Agent 设置中检测兼容性。'}</p>${a.installed&&['acp','doubao'].includes(a.kind)?`<button type="button" data-open-agent="${html(a.id)}">打开原应用</button>`:''}</article>`).join('')||'<p class="quota-empty">暂无本机 Agent 检测结果。</p>'}</div>${profiles.length?`<h3>API 与本机连接</h3><div class="quota-grid">${profiles.map(p=>`<article class="quota-card"><div class="quota-card-heading"><strong>${html(p.label)}</strong><span class="quota-badge muted">${p.mode==='direct'?'API 直连':'本机服务'}</span></div><p class="quota-note">${html(p.model)} · ${p.verification?.inference?'曾通过推理检查':'尚未验证推理'}</p><p class="quota-note">暂不支持余额查询，请在对应服务中查看。</p></article>`).join('')}</div>`:''}`;
}
