import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url),directory=await fs.mkdtemp(join(tmpdir(),'opentypora-smoke-run-'));
let output='';
try{
  await fs.writeFile(join(directory,'package.json'),JSON.stringify({name:'opentypora-services-smoke',version:'0.0.0',main:'main.cjs'}));
  await build({entryPoints:[join(dirname(fileURLToPath(import.meta.url)),'render.smoke.ts')],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:join(directory,'main.cjs')});
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[directory],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{output+=data.toString();process.stdout.write(data);});child.stderr.on('data',data=>process.stderr.write(data));
  const result=await new Promise((resolveResult,reject)=>{child.on('error',reject);child.on('close',code=>resolveResult(code));});
  const report=output.split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.renderSmoke);
  if(result!==0||!report)throw new Error(`实际渲染检查未通过，退出码 ${result}`);
  // Only remove the test data reported by this child after Chromium releases its database handles.
  const dataPath=resolve(report.directory),temp=resolve(tmpdir());if(dirname(dataPath).toLowerCase()!==temp.toLowerCase()||!/^opentypora-render-smoke-\d+$/.test(dataPath.slice(dirname(dataPath).length+1)))throw new Error('测试清理路径校验失败');
  await fs.rm(dataPath,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}finally{await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
