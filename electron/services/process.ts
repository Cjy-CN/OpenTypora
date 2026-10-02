import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { delimiter, dirname, join, isAbsolute, resolve } from 'node:path';
import { serviceError, string, strings } from './validation';
export interface CommandResult { stdout: string; stderr: string; exitCode: number }
export interface CommandOptions { cwd?: string; timeout?: number; signal?: AbortSignal; maxOutput?: number; input?: string }
export async function findExecutable(name: string): Promise<string | null> {
  string(name,'程序'); const suffixes=process.platform==='win32' ? ['',...(process.env.PATHEXT||'.EXE;.CMD;.BAT').split(';')] : [''];
  const dirs = isAbsolute(name) ? [''] : (process.env.PATH || '').split(delimiter);
  for (const directory of dirs) for (const suffix of suffixes) { const path=directory ? join(directory,name+suffix) : name+suffix; try { const stat=await fs.stat(path); if(stat.isFile())return path; }catch{} }
  return null;
}
export async function runCommand(executable: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
  executable=string(executable,'程序'); args=strings(args); let actual=await findExecutable(executable);
  if(!actual)throw serviceError('DEPENDENCY_MISSING',`找不到程序 ${executable}；请安装工具或在设置中填写绝对路径`);
  // Recognize npm's generated Windows shim, then invoke its Node entry point directly. Never execute batch/shell text.
  if(/\.(cmd|bat)$/i.test(actual)){
    const shim=await fs.readFile(actual,'utf8'),entry=shim.match(/"%dp0%[\\/]node_modules[\\/]([^"\r\n]+)"/i);
    if(!entry||!/(?:node\.exe|_prog.*node)/i.test(shim))throw serviceError('EXECUTABLE_REQUIRED','请配置 .exe 程序或 node.exe + CLI 脚本参数；不执行 shell 批处理');
    const script=resolve(dirname(actual),'node_modules',entry[1]);await fs.access(script);const node=await findExecutable(join(dirname(actual),'node.exe'))||await findExecutable('node');if(!node)throw serviceError('DEPENDENCY_MISSING','npm CLI需要Node.js，请安装Node.js或配置上传程序');args=[script,...args];actual=node;
  }
  return new Promise((resolve,reject)=>{
    if(options.signal?.aborted){reject(serviceError('CANCELLED','任务已取消'));return;}
    const child=spawn(actual,args,{cwd:options.cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',settled=false; const max=options.maxOutput??8_000_000;
    const finish=(error?:Error,code=0)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve({stdout,stderr,exitCode:code});};
    const abort=()=>{child.kill();finish(serviceError('CANCELLED','任务已取消'));};
    const timer=setTimeout(()=>{child.kill();finish(serviceError('COMMAND_TIMEOUT','转换或上传超时，请检查工具和网络'));},options.timeout??120_000);
    options.signal?.addEventListener('abort',abort,{once:true});
    const collect=(target:'stdout'|'stderr',data:Buffer)=>{if(target==='stdout')stdout+=data.toString();else stderr+=data.toString();if(stdout.length+stderr.length>max){child.kill();finish(serviceError('OUTPUT_LIMIT','外部工具输出过大'));}};
    child.stdout.on('data',data=>collect('stdout',data));child.stderr.on('data',data=>collect('stderr',data));
    child.on('error',error=>finish(error));child.on('close',code=>{if(code!==0)finish(serviceError('COMMAND_FAILED',`外部工具退出码 ${code ?? '未知'}`,redact(stderr||stdout)));else finish(undefined,0);});
    child.stdin.on('error',()=>undefined);if(options.input)child.stdin.write(options.input);child.stdin.end();
  });
}
export function redact(text: string): string { return text.replace(/(token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi,'$1=[隐藏]').slice(-10_000); }
export async function dependency(name:string,path?:string):Promise<{available:boolean;path?:string;version?:string}>{
  const actual=await findExecutable(path||name);if(!actual)return{available:false};
  try{const result=await runCommand(actual,['--version'],{timeout:5000,maxOutput:100_000});return{available:true,path:actual,version:result.stdout.trim().split(/\r?\n/)[0]||result.stderr.trim().split(/\r?\n/)[0]};}catch{return{available:false,path:actual};}
}
export function variables(args: string[], values: Record<string,string>): string[] { return args.map(arg=>arg.replace(/\$\{(input|output|resourceDir|title|file|filename|directory)\}/g,(_,key:string)=>values[key]??'')); }
