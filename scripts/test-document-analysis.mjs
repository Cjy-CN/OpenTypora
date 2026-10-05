// Exercise the actual React hooks, worker protocol and teardown in hidden Chromium.
import {build} from 'esbuild';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const require=createRequire(import.meta.url),directory=await fs.mkdtemp(join(tmpdir(),'opentypora-analysis-'));
try{
 await build({entryPoints:['src/ui/analysis.worker.ts'],bundle:true,platform:'browser',format:'esm',outfile:join(directory,'analysis.worker.js'),logLevel:'warning'});
 await build({entryPoints:['tests/document-analysis/renderer.tsx'],bundle:true,platform:'browser',format:'esm',outfile:join(directory,'renderer.js'),define:{'process.env.NODE_ENV':'"production"'},logLevel:'warning',plugins:[{
  name:'test-worker-output-path',setup(builder){builder.onLoad({filter:/[\\/]useDocumentAnalysis\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace("'./analysis.worker.ts'","'./analysis.worker.js'"),loader:'ts',resolveDir:dirname(args.path)}));}
 }]});
 await fs.writeFile(join(directory,'index.html'),'<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="renderer.js"></script>');
 await fs.writeFile(join(directory,'package.json'),JSON.stringify({name:'opentypora-document-analysis-test',version:'0.0.0',main:'main.cjs'}));
 await fs.copyFile('tests/document-analysis/main.cjs',join(directory,'main.cjs'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[directory],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',value=>{output+=value;process.stdout.write(value);});child.stderr.on('data',value=>process.stderr.write(value));
 const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('close',done);});
 if(code!==0||!output.includes('"documentAnalysis":true'))throw new Error(`Document analysis test failed (${code})`);
}finally{
 const target=resolve(directory);if(dirname(target)!==resolve(tmpdir())||!target.split(/[\\/]/).at(-1).startsWith('opentypora-analysis-'))throw new Error('Invalid analysis test cleanup path');
 await fs.rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
