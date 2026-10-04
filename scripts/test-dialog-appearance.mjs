// Real Chromium style checks with isolated fixtures, data and a hidden window.
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url),directory=await fs.mkdtemp(join(tmpdir(),'opentypora-dialog-appearance-'));
try{
  await build({entryPoints:['tests/dialog-appearance/renderer.tsx'],bundle:true,platform:'browser',format:'iife',outfile:join(directory,'renderer.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning'});
  await fs.writeFile(join(directory,'index.html'),'<meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><div id="root"></div><script src="renderer.js"></script>');
  await fs.writeFile(join(directory,'package.json'),JSON.stringify({name:'opentypora-dialog-appearance',version:'0.0.0',main:'main.cjs'}));
  await fs.copyFile('tests/dialog-appearance/main.cjs',join(directory,'main.cjs'));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(require('electron'),[directory],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',value=>{output+=value;process.stdout.write(value);});child.stderr.on('data',value=>process.stderr.write(value));
  const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('close',done);});
  if(code!==0||!output.includes('"dialogAppearance":true'))throw new Error(`Dialog appearance check failed (${code})`);
}finally{
  const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!target.split(/[\\/]/).at(-1).startsWith('opentypora-dialog-appearance-'))throw new Error('Invalid test cleanup path');
  await fs.rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
