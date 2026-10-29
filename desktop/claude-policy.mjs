import {realpathSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname,basename,join} from 'node:path';

export const claudeTools=['Read','Glob','Grep','Write','Edit','Bash','AskUserQuestion','Agent','TodoWrite'];
const reads=new Set(['Read','Glob','Grep']);
function canonical(path){const tail=[];let current=path;for(;;){try{return join(realpathSync(current),...tail.reverse());}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw error;const parent=dirname(current);if(parent===current)throw error;tail.push(basename(current));current=parent;}}}
export function claudeToolDecision(folder,tool,input,cwd=folder){
 if(!claudeTools.includes(tool))return {deny:'This tool is not enabled by gfot.'};
 if(tool==='AskUserQuestion')return {question:true};
 if(tool==='Glob'&&(typeof input.pattern!=='string'||isAbsolute(input.pattern)||input.pattern.split(/[\/]/).includes('..')))return {ask:true,reason:'Approve a glob pattern that may search outside the selected project'};
 if(reads.has(tool)){
  const target=tool==='Read'?input.file_path:input.path||cwd;
  if(typeof target!=='string')return {deny:'Cannot resolve filesystem tool target.'};
  try{const delta=relative(realpathSync(folder),canonical(resolve(cwd,target)));if(delta!=='..'&&!delta.startsWith('../')&&!isAbsolute(delta))return {allow:true};}
  catch{return {deny:'Cannot resolve filesystem tool target.'};}
  return {ask:true,reason:'Read or search outside the selected project'};
 }
 return {ask:true,reason:'Approve this operation once'};
}
