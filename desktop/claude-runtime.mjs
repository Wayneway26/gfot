import {accessSync,constants,statSync,realpathSync,mkdtempSync,rmSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir,tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {InputError} from './state.mjs';

export const claudeSdkVersion='0.3.312',claudeCodeVersion='2.1.312';
const execute=promisify(execFile);
export function claudeCandidates(){return [...new Set([join(homedir(),'.local/bin/claude'),'/opt/homebrew/bin/claude','/usr/local/bin/claude'].filter(path=>{try{accessSync(path,constants.X_OK);return statSync(path).isFile();}catch{return false;}}))];}
export async function inspectClaudeRuntime(path,{signal,onProcess}={}){
 if(typeof path!=='string'||!isAbsolute(path)||path.length>4096)throw new InputError('请选择 Claude Code 可执行文件');
 let binary;try{binary=realpathSync(path);if(!statSync(binary).isFile())throw Error();accessSync(binary,constants.X_OK);}catch{throw new InputError('Claude Code 文件不存在或不可执行，请重新选择');}
 const home=mkdtempSync(join(tmpdir(),'gfot-claude-version-'));let probe;
 try{
  const check=execute(binary,['--version'],{cwd:home,env:{HOME:home,CLAUDE_CONFIG_DIR:join(home,'config'),PATH:'/usr/bin:/bin',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},timeout:10000,maxBuffer:4096,signal,killSignal:'SIGKILL',detached:true});probe=check.child;onProcess?.(probe);const result=await check;
  const match=result.stdout.match(/^(\d+\.\d+\.\d+) \(Claude Code\)\s*$/);
  if(!match||match[1]!==claudeCodeVersion)throw new InputError('当前适配支持 Claude Code '+claudeCodeVersion+'；请选择该版本的本机执行文件');
  return {path:binary,version:match[1],selectedAt:new Date().toISOString()};
 }catch(error){if(error instanceof InputError)throw error;throw new InputError('无法检查 Claude Code 版本，请确认可执行文件能够启动');}
 finally{if(probe?.pid){try{process.kill(-probe.pid,'SIGKILL');}catch{}}rmSync(home,{recursive:true,force:true});}
}
