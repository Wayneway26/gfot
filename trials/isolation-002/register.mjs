import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const files = ['review-bundle.mjs', 'public/review-policy.js', 'public/review-export.js', 'public/app.js', 'server.mjs', 'package.json', 'test/review-bundle.test.mjs', 'test/server.test.mjs'];
const manifest = files.map(path => ({ path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
const version = 'isolation-' + createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0, 12);
const base = 'http://127.0.0.1:4317/api/projects';
async function post(path, body) { const r = await fetch(base + path, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw Error(x.error);return x; }
const p = await post('', {title:'审查材料副本导出',goal:'只打包用户选中的文本快照，生成可预览、可校验的审查副本，不让导出接口读取真实仓库目录。',repo:'/Users/wayne/AgentSummary',baseline:'UTF-8 修复后的本地 MVP',scope:'review-bundle.mjs、public/review-policy.js、public/review-export.js、server 路由、界面入口及测试',constraints:'材料隔离不等于外部 Agent 权限沙箱；不发送外部服务，不自动标记派发或验收。',criteria:'选择文件后可勾选或排除，并查看排除原因\n拒绝 data/、隐藏目录、凭证文件名、路径跳转、重复路径和过大文件\n每份选中文本有 SHA256，副本包含目标、验收条件、diff 和源码\n必须确认交付版本，导出不改变任务状态、不保存上传源码\n不能宣称 WorkBuddy 已受权限隔离',implementer:'Codex',reviewer:'WorkBuddy'});
await post('/'+p.id,{action:'dispatch'});
const changes = ['新增审查副本模块、共享文件筛选规则和前端导出预览。','修改 server 路由以接收显式文本输入；不提供仓库文件读取接口。','新增 7 项边界测试，并扩展真实 HTTP 持久化与静态资源测试。'].join('\n');
await post('/'+p.id,{action:'result',summary:changes,artifact:files.map(path=>'新增或修改：'+path).join('\n')+'\n完整快照哈希：trials/isolation-002/manifest.json',version,evidence:'源码清单及 SHA256 见 trials/isolation-002/manifest.json；边界测试见 test/review-bundle.test.mjs。',tests:'npm run check 通过；npm test 21/21 通过；包括路径跳转、data/、凭证文件名、大小限制、版本确认、内容围栏及真实 HTTP 导出后不持久化源码。',issues:'本机 sandbox-exec 探针无法正常启动，未启用执行沙箱；外部 Agent 进程仍可能拥有原有广泛权限。文本筛选不是秘密扫描；文件与交付版本对应关系由用户确认。此功能尚未经过外部独立审查。',next:'先在界面选择明确授权文件并检查副本。需要外部复审时只交付副本，不能据此声称执行端权限已限制。'});
writeFileSync('trials/isolation-002/manifest.json',JSON.stringify({version,files:manifest},null,2));
writeFileSync('trials/isolation-002/project.json',JSON.stringify({id:p.id,version},null,2));
console.log(JSON.stringify({id:p.id,version}));
