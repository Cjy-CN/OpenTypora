// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {UpdateDialog} from '../src/ui/UpdateDialog';
import type {DesktopBridge,Result} from '../src/shared/contracts';

const digest='a'.repeat(64);
const release={current:'0.1.0',version:'1.0.0',available:true,channel:'stable',notes:'修复 <script>alert(1)</script>\n发行说明',url:'https://example.com/release',assets:[{name:'OpenTypora.zip',url:'https://example.com/OpenTypora.zip',size:1024},{name:'OpenTypora.exe',url:'https://example.com/OpenTypora.exe',size:4096,digest:`sha256:${digest}`}]};
const downloaded={status:'downloaded',path:'C:\\App Data\\updates\\OpenTypora.exe',size:4096,sha256:digest};
const ok=(value:unknown):Result<unknown>=>({ok:true,value});
const failure=(code:string,message:string):Result<unknown>=>({ok:false,error:{code,message,retryable:true,detail:'请检查发行源'}});
let container:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();});
async function flush(){await new Promise(resolve=>setTimeout(resolve,0));}
async function mount(handler:(name:string,options?:Record<string,unknown>)=>Promise<Result<unknown>>,onClose=vi.fn()){
  const systemAction=vi.fn(handler),reveal=vi.fn(async()=>({ok:true,value:undefined})),openExternal=vi.fn(async()=>({ok:true,value:undefined}));
  const bridge={systemAction,reveal,openExternal} as unknown as DesktopBridge;
  await act(async()=>{root.render(<UpdateDialog bridge={bridge} onClose={onClose}/>);await flush();});return {systemAction,reveal,openExternal,onClose};
}
function button(label:string){const found=[...container.querySelectorAll('button')].find(item=>item.textContent===label);if(!found)throw new Error(`未找到按钮：${label}`);return found;}
async function click(label:string){await act(async()=>{button(label).click();await flush();});}

it('checks the real bridge, renders notes as text and does not install until requested',async()=>{
  const {systemAction,reveal}=await mount(async(name)=>name==='updates.check'?ok(release):name==='updates.download'?ok(downloaded):name==='updates.install'?ok({status:'installer-opened',path:downloaded.path}):ok(undefined));
  expect(systemAction).toHaveBeenCalledExactlyOnceWith('updates.check',undefined);
  expect(container.textContent).toContain('1.0.0');expect(container.textContent).toContain('<script>alert(1)</script>');expect(container.querySelector('script')).toBeNull();
  const select=container.querySelector<HTMLSelectElement>('select')!;
  await act(async()=>{select.value=release.assets[1].url;select.dispatchEvent(new Event('change',{bubbles:true}));});
  await click('下载所选文件');expect(systemAction).toHaveBeenCalledWith('updates.download',{url:release.assets[1].url,sha256:digest});
  expect(container.textContent).toContain(downloaded.path);expect(container.textContent).toContain(digest);expect(systemAction.mock.calls.some(([name])=>name==='updates.install')).toBe(false);
  await click('打开所在目录');expect(reveal).toHaveBeenCalledWith(downloaded.path);
  await click('打开安装文件');expect(systemAction).toHaveBeenCalledWith('updates.install',undefined);expect(container.textContent).toContain('安装程序已打开，请按安装程序提示完成安装。');
  expect(container.textContent).not.toContain('安装完成');
});

it('shows HTTP errors and successfully retries without a simulated version',async()=>{
  let checks=0;const {systemAction}=await mount(async()=>++checks===1?failure('UPDATE_HTTP','更新源 HTTP 404；请配置可访问的发行镜像'):ok(release));
  expect(container.querySelector('[role=alert]')?.textContent).toContain('UPDATE_HTTP');expect(container.querySelector('[role=alert]')?.textContent).toContain('404');expect(container.textContent).not.toContain('发现新版本');
  await click('重新检查');expect(systemAction).toHaveBeenCalledTimes(2);expect(container.querySelector('[role=alert]')).toBeNull();expect(container.textContent).toContain('发现新版本 1.0.0');
});

it('cancels a pending download and ignores its late completion',async()=>{
  let finish!:(value:Result<unknown>)=>void;const pending=new Promise<Result<unknown>>(resolve=>{finish=resolve;});
  const {systemAction}=await mount(async(name)=>name==='updates.check'?ok(release):name==='updates.download'?pending:ok({status:'cancelled'}));
  await click('下载所选文件');expect(container.querySelector('[role=status]')?.textContent).toContain('正在下载');await click('取消下载');
  expect(systemAction).toHaveBeenCalledWith('updates.cancel',undefined);expect(container.querySelector('[role=status]')?.textContent).toContain('下载已取消');
  await act(async()=>{finish(ok(downloaded));await flush();});expect(container.textContent).not.toContain(downloaded.path);expect(container.textContent).not.toContain('打开安装文件');
});

it('keeps the dialog open when closing cannot cancel, then waits for cancellation before close',async()=>{
  let finish!:(value:Result<unknown>)=>void;let cancels=0;const pending=new Promise<Result<unknown>>(resolve=>{finish=resolve;});
  const {onClose}=await mount(async(name)=>name==='updates.check'?ok(release):name==='updates.download'?pending:++cancels===1?failure('UPDATE_CANCEL','无法取消'):ok({status:'cancelled'}));
  await click('下载所选文件');await click('关闭');expect(onClose).not.toHaveBeenCalled();expect(container.querySelector('[role=alert]')?.textContent).toContain('无法取消');
  await click('关闭');expect(onClose).toHaveBeenCalledOnce();await act(async()=>{finish(ok(downloaded));await flush();});expect(container.textContent).not.toContain(downloaded.path);
});

it('blocks installation when the download return value or checksum is invalid',async()=>{
  let downloads=0;const {systemAction}=await mount(async(name)=>name==='updates.check'?ok(release):ok(++downloads===1?{status:'downloaded',path:'C:\\update.exe'}:{...downloaded,sha256:'b'.repeat(64)}));
  const select=container.querySelector<HTMLSelectElement>('select')!;await act(async()=>{select.value=release.assets[1].url;select.dispatchEvent(new Event('change',{bubbles:true}));});
  await click('下载所选文件');expect(container.querySelector('[role=alert]')?.textContent).toContain('UPDATE_INVALID_RESPONSE');expect(container.textContent).not.toContain('打开安装文件');
  await click('下载所选文件');expect(container.querySelector('[role=alert]')?.textContent).toContain('UPDATE_INTEGRITY');expect(systemAction.mock.calls.some(([name])=>name==='updates.install')).toBe(false);
});

it('retains the downloaded file and permits retry if the system cannot open the installer',async()=>{
  let installs=0;const {systemAction}=await mount(async(name)=>name==='updates.check'?ok(release):name==='updates.download'?ok(downloaded):++installs===1?failure('UPDATE_INSTALL','Windows 未能打开安装文件'):ok({status:'archive-opened',path:downloaded.path}));
  await click('下载所选文件');await click('打开安装文件');expect(container.querySelector('[role=alert]')?.textContent).toContain('Windows 未能打开');expect(container.textContent).toContain(downloaded.path);expect(button('打开安装文件').disabled).toBe(false);
  await click('打开安装文件');expect(systemAction.mock.calls.filter(([name])=>name==='updates.install')).toHaveLength(2);expect(container.querySelector('[role=status]')?.textContent).toContain('发行压缩包已打开');
});

it('shows no update and missing release assets accurately',async()=>{
  let checks=0;await mount(async()=>ok(++checks===1?{current:'1.0.0',available:false,channel:'stable'}:{...release,assets:[]}));
  expect(container.textContent).toContain('当前没有可用更新');expect(container.textContent).not.toContain('下载所选文件');await click('重新检查');expect(container.querySelector('[role=alert]')?.textContent).toContain('没有提供 exe、msi 或 zip');expect(container.textContent).not.toContain('下载所选文件');
});

it('reports unavailable desktop services rather than claiming update success',async()=>{
  await act(async()=>{root.render(<UpdateDialog onClose={vi.fn()}/>);await flush();});expect(container.querySelector('[role=alert]')?.textContent).toContain('DESKTOP_REQUIRED');expect(button('重新检查').disabled).toBe(true);expect(container.textContent).not.toContain('当前没有可用更新');
});
