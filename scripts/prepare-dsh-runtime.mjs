import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('../desktop/runtime/dsh/',import.meta.url));
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('The current gfot desktop package targets macOS arm64.');
const version='26.4.0',archive='node-v'+version+'-darwin-arm64.tar.gz';
const expected='4f4fbcacf6b1ff1a95deedba7bd7b2d79efecaa53a8ecb0530546dc9063fefbc';
const run=(command,args)=>{const result=spawnSync(command,args,{cwd:root,stdio:'inherit'});if(result.status!==0)throw Error(command+' failed');};
run(process.platform==='win32'?'npm.cmd':'npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
const node=join(root,'node'),binary=join(node,'bin','node'),stamp=join(node,'PROVENANCE.json');
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
if(existsSync(binary)&&existsSync(stamp)){
 const saved=JSON.parse(readFileSync(stamp,'utf8'));
 if(saved.archiveSHA256===expected&&saved.binarySHA256===digest(binary)){console.log('Verified dsh Node runtime '+version);process.exit(0);}
}
mkdirSync(node,{recursive:true});const download=join(root,archive);
try{
 run('/usr/bin/curl',['--fail','--location','--retry','2','--max-time','180','https://nodejs.org/dist/v'+version+'/'+archive,'-o',download]);
 if(digest(download)!==expected)throw Error('Official Node archive checksum mismatch');
 run('/usr/bin/tar',['-xzf',download,'--strip-components=1','-C',node,'node-v'+version+'-darwin-arm64/bin/node','node-v'+version+'-darwin-arm64/LICENSE']);
 chmodSync(binary,0o755);writeFileSync(stamp,JSON.stringify({version,url:'https://nodejs.org/dist/v'+version+'/'+archive,archiveSHA256:expected,binarySHA256:digest(binary)},null,2)+'\n');
}finally{rmSync(download,{force:true});}
