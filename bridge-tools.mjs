import { handoffTools } from './handoff-tools.mjs';
const string = { type:'string', minLength:1 };
const schema = (properties, required=[]) => ({type:'object',properties,required,additionalProperties:false});
export const bridgeTools = [
 ...handoffTools,
 {name:'bridge_status',description:'检查 gfot 桥接服务范围；不会启动或推送 Agent。',inputSchema:schema({}),annotations:{readOnlyHint:true}},
 {name:'list_review_jobs',description:'仅列出用户主动发布的审查派发。不读取仓库、未发布项目或会话。',inputSchema:schema({}),annotations:{readOnlyHint:true}},
 {name:'get_review_job',description:'领取一份审查副本并返回领取凭证。只静态审查返回内容，不读取原目录或执行代码。重复领取须传原凭证。',inputSchema:schema({jobId:string,claimToken:string},['jobId']),annotations:{readOnlyHint:false,destructiveHint:false}},
 {name:'submit_review',description:'提交与派发、副本、代码版本严格匹配的审查结果。自动保存，等待用户应用；不能验收或修改代码。相同结果重复提交幂等。',inputSchema:schema({jobId:string,claimToken:string,bundleId:string,reviewedVersion:string,verdict:{enum:['pass','rework']},source:string,criteriaEvidence:string,findings:string},['jobId','claimToken','bundleId','reviewedVersion','verdict','source','criteriaEvidence','findings']),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true}}
];
