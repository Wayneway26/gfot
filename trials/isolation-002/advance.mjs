import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extractReviewFiles } from '../../review-snapshot.mjs';
const dir = 'trials/isolation-002';
const meta = JSON.parse(readFileSync(dir+'/project.json','utf8'));
const endpoint = 'http://127.0.0.1:4317/api/projects/'+meta.id;
const p = await (await fetch(endpoint)).json();
if (p.stage !== 'review' || p.status !== 'ready' || p.revision !== 1) throw Error('Only the undispatched first revision may advance');
const before = new Map(extractReviewFiles(readFileSync(dir+'/review-copy.md','utf8')).map(f=>[f.path,f.content]));
const files = [...before.keys(), 'review-snapshot.mjs', 'scripts/isolated-check.mjs', 'test/review-snapshot.test.mjs'].sort();
let diff = '';
for (const path of files) {
 const text = readFileSync(path,'utf8');
 if (before.get(path) === text) continue;
 const oldPath = join(dir,'before-v2',path); mkdirSync(dirname(oldPath),{recursive:true});
 writeFileSync(oldPath,before.get(path)||'');
 const result = spawnSync('diff',['-u','--label','a/'+path,oldPath,'--label','b/'+path,path],{encoding:'utf8'});
 if (![0,1].includes(result.status)) throw Error(result.stderr);
 diff += result.stdout;
}
writeFileSync(dir+'/v2-changes.diff',diff);
const manifest = files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
const version = 'isolation-'+createHash('sha256').update(JSON.stringify(manifest)).digest('hex').slice(0,12);
async function act(input) {const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});const x=await r.json();if(!r.ok)throw Error(x.error);return x;}
await act({action:'revise',goal:p.goal+' 同时提供只挂载副本、禁外网、只读的本地容器命令检查器。',criteria:p.criteria+'\n隔离检查器拒绝远程 Docker 和无容器回退；容器不能读取宿主数据、改写副本或访问外网',baseline:'材料副本导出 v1；仅追加受控命令检查能力'});
await act({action:'dispatch'});
await act({action:'result',summary:'审查副本导出已完成；新增严格校验 Markdown 快照的解析器，以及只允许本机 Docker、固定镜像摘要、无外网、只读、非特权的命令检查器。',artifact:diff,version,evidence:'trials/isolation-002/manifest.json、v2-changes.diff、final-test.log、container-check.log、export-verification.json。',tests:'最新宿主源码 npm run check 通过，npm test 24/24 通过。从界面导出的 v1 副本在 Node22 容器中 syntax-check 与21/21测试通过；边界探针确认不可修改副本、不可写根目录、不可读取宿主数据、无Docker socket、不能连接外网。',issues:'容器只限制其内的命令，不限制 WorkBuddy 桌面进程。macOS sandbox-exec 探针未正常启动，无宿主执行回退。此功能尚未独立外部复审，未再次发送 WorkBuddy。',next:'先按当前代码版本选择文件导出副本；需要执行时使用本地容器检查器，保留文件权限边界说明。'});
if (!existsSync(dir+'/manifest-v1.json')) copyFileSync(dir+'/manifest.json',dir+'/manifest-v1.json');
writeFileSync(dir+'/manifest.json',JSON.stringify({version,files:manifest},null,2));
writeFileSync(dir+'/project.json',JSON.stringify({...meta,version,revision:2},null,2));
console.log(JSON.stringify({id:p.id,version,revision:2}));
