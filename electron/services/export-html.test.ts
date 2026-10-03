// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { exportHtml, ExportService, type RenderService } from './export';
import { renderMarkdown } from '../../src/render/markdown';
import { DEFAULT_SETTINGS, type SettingsSnapshot } from '../../src/shared/settings';
import type { ExportSnapshot } from '../../src/shared/contracts';

let directory:string;
beforeEach(async()=>{directory=await fs.mkdtemp(join(tmpdir(),'opentypora-export-html-'));});
afterEach(async()=>{await fs.rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
const markdown='A  B\nC  D\n\n- item  one\n  next  line\n\n```\ncode  one\ncode  two\n```\n\nhard  \nbreak\n';
const themeCss='.opentypora-export{font:16px/1.5 monospace;color:rgb(18,52,86)}.opentypora-export.preserve-spaces :is(p,li){white-space:pre-wrap}';
function snapshot(preserveSpaces:boolean,preserveBreaks:boolean):ExportSnapshot{
  const settings={...DEFAULT_SETTINGS,'text.preserveSpaces':preserveSpaces,'text.preserveBreaks':preserveBreaks} as SettingsSnapshot;
  return{documentId:'export-whitespace',version:3,path:null,text:markdown,title:'空白导出',html:renderMarkdown(markdown,settings),profile:{id:'whitespace',name:'HTML',format:'html',extension:'html',args:[],openFile:false,openFolder:false,options:{themeCss,fontSize:20,preserveSpaces,preserveBreaks}}};
}
const noRender:RenderService={pdf:async()=>{throw new Error('HTML磁盘测试不调用PDF渲染');},image:async()=>{throw new Error('HTML磁盘测试不调用图片渲染');}};

describe('HTML导出和打印共用的样式/空白消费',()=>{
  it.each([[true,true],[true,false],[false,true],[false,false]])('消费 preserveSpaces=%s / preserveBreaks=%s，保留正文/代码',async(spaces,breaks)=>{
    const value=snapshot(spaces,breaks),html=await exportHtml(value,value.profile.options,[]),document=new DOMParser().parseFromString(html,'text/html');
    expect(document.body.classList.contains('opentypora-export')).toBe(true);
    expect(document.body.classList.contains('preserve-spaces')).toBe(spaces);
    expect(document.body.classList.contains('preserve-breaks')).toBe(breaks);
    expect(document.head.textContent).toContain(themeCss);
    expect(document.querySelector('main>p')!.innerHTML).toBe(breaks?'A  B<br>C  D':'A  B C  D');
    expect(document.querySelector('pre code')!.textContent).toBe('code  one\ncode  two\n');
    expect(document.querySelector('main>p:last-child')!.querySelector('br')).not.toBeNull();
    expect(value.text).toBe(markdown);
  });
  it('原快照style留在head并可匹配导出body，实际HTML文件落盘',async()=>{
    const value=snapshot(true,true);value.html=`<html><head><style>.opentypora-export h1{letter-spacing:3px}</style></head><body>${value.html}</body></html>`;
    const output=join(directory,'styled.html'),service=new ExportService(directory,noRender);await service.export(value,output,{});
    const document=new DOMParser().parseFromString(await fs.readFile(output,'utf8'),'text/html');
    expect(document.head.querySelector('style')!.textContent).toContain('.opentypora-export h1');expect(document.body.classList.contains('opentypora-export')).toBe(true);
    expect(document.querySelector('pre code')!.textContent).toBe('code  one\ncode  two\n');expect(await fs.readdir(join(directory,'exports'))).toEqual([]);
  });
  it('无样式HTML实际落盘，不携带样式和排版class',async()=>{
    const value=snapshot(true,true);value.profile.format='html-plain';value.html=`<style>.opentypora-export{color:red}</style><p class="preview" style="color:red">A  B<br>C  D</p><pre><code>code  one\ncode  two</code></pre>`;
    const output=join(directory,'plain.html');await new ExportService(directory,noRender).export(value,output,{});const document=new DOMParser().parseFromString(await fs.readFile(output,'utf8'),'text/html');
    expect(document.querySelector('style,[class],[style]')).toBeNull();expect(document.querySelector('p')!.innerHTML).toBe('A  B<br>C  D');expect(document.querySelector('pre code')!.textContent).toBe('code  one\ncode  two');
  });
  it('真实Electron隐藏页面四组合实际排版：连续空格、软换行、列表、硬换行及代码',async()=>{
    const cases=[];for(const spaces of [true,false])for(const breaks of [true,false]){const value=snapshot(spaces,breaks),name=`case-${spaces}-${breaks}.html`;await fs.writeFile(join(directory,name),await exportHtml(value,value.profile.options,[]));cases.push({name,spaces,breaks});}await fs.writeFile(join(directory,'cases.json'),JSON.stringify(cases));
    // A real Chromium layout check, isolated from production user data and never displayed.
    await fs.writeFile(join(directory,'main.cjs'),String.raw`
const { app, BrowserWindow } = require('electron');const fs=require('node:fs'),path=require('node:path');
app.setPath('userData',path.join(__dirname,'userdata'));app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{const reports=[];const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,spellcheck:false}});try{
for(const entry of JSON.parse(fs.readFileSync(path.join(__dirname,'cases.json'),'utf8'))){await win.loadFile(path.join(__dirname,entry.name));const layout=await win.webContents.executeJavaScript("(()=>{const p=document.querySelector('main>p'),li=document.querySelector('li'),code=document.querySelector('pre code'),hard=document.querySelector('main>p:last-child'),style=getComputedStyle(p),node=p.firstChild;const range=document.createRange();range.setStart(node,0);range.setEnd(node,1);const a=range.getBoundingClientRect();const index=node.textContent.indexOf('B');range.setStart(node,index);range.setEnd(node,index+1);const b=range.getBoundingClientRect();return{classes:document.body.className,whiteSpace:style.whiteSpace,listWhiteSpace:getComputedStyle(li).whiteSpace,color:style.color,fontSize:style.fontSize,lines:Math.round(p.getBoundingClientRect().height/parseFloat(style.lineHeight)),spaceUnits:Math.round((b.left-a.left)/a.width),hardLines:Math.round(hard.getBoundingClientRect().height/parseFloat(getComputedStyle(hard).lineHeight)),codeText:code.textContent,codeWhiteSpace:getComputedStyle(code).whiteSpace}})()");const pdf=await win.webContents.printToPDF({pageSize:'A4',printBackground:true});if(pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('printToPDF未生成真实PDF');fs.writeFileSync(path.join(__dirname,entry.name+'.pdf'),pdf);reports.push({...entry,...layout,pdfBytes:pdf.length});}
console.log(JSON.stringify({exportWhitespaceLayout:true,reports}));win.destroy();app.exit(0);
}catch(error){console.error(error);win.destroy();app.exit(1);}});
`);
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(createRequire(import.meta.url)('electron'),[join(directory,'main.cjs')],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data.toString());child.stderr.on('data',data=>stderr+=data.toString());
    const code=await new Promise<number|null>((resolve,reject)=>{const timeout=setTimeout(()=>{child.kill();reject(new Error('隐藏Electron排版测试超时'));},10_000);child.on('error',error=>{clearTimeout(timeout);reject(error);});child.on('close',result=>{clearTimeout(timeout);resolve(result);});});
    expect(code,stderr).toBe(0);const report=stdout.split(/\r?\n/).map(line=>{try{return JSON.parse(line);}catch{return null;}}).find(value=>value?.exportWhitespaceLayout);expect(report,stdout+stderr).toBeDefined();expect(report.reports).toHaveLength(4);
    for(const result of report.reports){expect(result.whiteSpace).toBe(result.spaces?'pre-wrap':result.breaks?'pre-line':'normal');expect(result.listWhiteSpace).toBe(result.whiteSpace);expect(result.lines).toBe(result.breaks?2:1);expect(result.spaceUnits).toBe(result.spaces?3:2);expect(result.hardLines).toBe(2);expect(result.color).toBe('rgb(18, 52, 86)');expect(result.fontSize).toBe('20px');expect(result.codeText).toBe('code  one\ncode  two\n');expect(result.codeWhiteSpace).toBe('pre-wrap');expect(result.pdfBytes).toBeGreaterThan(1000);}
  },15_000);
});
