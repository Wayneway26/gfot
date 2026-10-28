// A source describes model access, independently of a native Agent executor.
export function modelSources(agents){
 const native=id=>!!agents.find(a=>a.id===id)?.available;
 return [
  {id:'codex',name:'Codex',modelAccess:'credential',action:'codex',note:'导入访问凭证，内置 dsh 使用对应账号的模型与额度；过期后重新导入。'},
  {id:'opencode',name:'OpenCode',modelAccess:'api-key-import',action:'opencode',native:native('opencode-local'),note:'导入 OpenCode auth.json 的 API Key；OAuth 与新版数据库凭证需单独适配。'},
  {id:'doubao',name:'豆包工作',modelAccess:'unverified',native:native('doubao'),note:'已有实验性原生执行接入；尚未验证可供 dsh 使用的订阅模型接口。'},
  {id:'qoder',name:'Qoder',modelAccess:'unverified',native:false,note:'尚未验证订阅模型接口与原生执行适配；已安装不代表可以接入额度。'},
  {id:'workbuddy',name:'WorkBuddy',modelAccess:'unverified',native:native('workbuddy')||native('workbuddy-ai'),note:'已有原生 CLI 执行接入；尚未验证可供 dsh 使用的订阅模型接口。'},
 ];
}
