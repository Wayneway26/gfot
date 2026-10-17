const text={type:'string',minLength:1,maxLength:30000};
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const checkpoint=schema(Object.fromEntries(['version','summary','artifact','evidence','tests','issues','next'].map(name=>[name,text])),['version','summary','artifact','evidence','tests','issues','next']);
const receipt={handoffId:text,claimToken:text,expectedSequence:{type:'integer',minimum:0},checkpoint};
export const handoffTools=[
 {name:'list_handoffs',description:'列出用户主动发布的实现接续交接；不启动 Agent、不读取仓库。',inputSchema:schema({}),annotations:{readOnlyHint:true}},
 {name:'get_handoff',description:'读取已发布交接：项目目录、任务、有效记忆和检查点。先核对本地实际版本，不代表已取得文件权限。',inputSchema:schema({handoffId:text},['handoffId']),annotations:{readOnlyHint:true}},
 {name:'claim_handoff',description:'核对目录和版本后领取交接。agent 仅为执行端自报名称，不是客户端身份认证。保存返回的领取凭证与 sequence；不能并发领取。',inputSchema:schema({handoffId:text,agent:{enum:['Codex','WorkBuddy']},observedRepo:text,observedVersion:text,claimToken:text},['handoffId','agent','observedRepo','observedVersion']),annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'save_checkpoint',description:'回写当前交接的阶段进度、版本、决策依据、未提交修改及待办。必须使用当前凭证与序号；不会自动把决策提升为有效记忆。',inputSchema:schema(receipt,Object.keys(receipt)),annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'complete_handoff',description:'提交完整实现结果并进入等待独立审查；不运行代码、不审查通过或最终验收。必须使用当前领取凭证及序号。',inputSchema:schema(receipt,Object.keys(receipt)),annotations:{readOnlyHint:false,destructiveHint:false}}
];
