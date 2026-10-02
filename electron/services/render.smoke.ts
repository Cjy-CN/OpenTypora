/** Build this entry with esbuild and run with Electron. Uses only isolated temporary data and hidden windows. */
import { app, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRenderService } from './render';
import { createPlatform } from './index';
const directory=join(tmpdir(),`opentypora-render-smoke-${process.pid}`);app.setPath('userData',directory);
app.on('window-all-closed',()=>undefined);
const timeout=setTimeout(()=>{console.error('RENDER_SMOKE_TIMEOUT');app.exit(1);},40_000);
app.whenReady().then(async()=>{
  try{
    await fs.mkdir(directory,{recursive:true});const render=createRenderService(directory),html='<html><head><meta charset="UTF-8"><style>body{font:18px sans-serif}svg{width:100px;height:100px}</style></head><body><h1>中文PDF与图片</h1><p>真实隐藏窗口渲染内容</p><svg viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg></body></html>';
    const pdf=await render.pdf(html,{pageSize:'A5',margins:'10mm',author:'中文作者',title:'测试PDF',header:'<span class="title"></span>',footer:'<span class="pageNumber"></span>'});if(pdf.subarray(0,5).toString()!=='%PDF-')throw new Error('PDF不是真实PDF文件');if(!pdf.toString('latin1').includes('/Author <FEFF'))throw new Error('PDF作者未写入');await fs.writeFile(join(directory,'test.pdf'),pdf);
    const pngs=await render.image(html,{imageWidth:640,imageQuality:90});if(!pngs.length||pngs[0].subarray(1,4).toString()!=='PNG')throw new Error('图片不是PNG');if(pngs[0].readUInt32BE(16)!==640)throw new Error('图片宽度不是640');await fs.writeFile(join(directory,'test.png'),pngs[0]);
    const longHtml=html.replace('</body>',`<div style="height:19000px;background:linear-gradient(white,blue)"></div></body>`),parts=await render.image(longHtml,{imageWidth:400});if(parts.length<2)throw new Error('长图没有分段');
    const jpeg=await render.image(html,{imageWidth:400,imageFormat:'jpeg',imageQuality:.8});if(jpeg[0][0]!==255||jpeg[0][1]!==216)throw new Error('JPEG不是JPEG文件');
    const hidden=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}}),platform=createPlatform(hidden);if(createPlatform(hidden)!==platform)throw new Error('每次IPC重复创建平台');await hidden.loadURL('data:text/html,<p>isolated test</p>');
    const path=join(directory,'roundtrip.md');const saved=await platform.save({path,text:'# 测试\r\n\n',encoding:'utf-8',bom:true,version:1,expectedFingerprint:null});const opened=await platform.open(path);if(opened.text!=='# 测试\r\n\n'||saved.version!==1)throw new Error('Bridge文件正文不一致');
    const changes:string[]=[];const originalSend=hidden.webContents.send.bind(hidden.webContents);hidden.webContents.send=(channel:string,...args:unknown[])=>{if(channel==='opentypora:fileChanged')changes.push(String(args[0]));originalSend(channel,...args);};await new Promise(resolve=>setTimeout(resolve,150));changes.length=0;await fs.writeFile(path,'external');await new Promise(resolve=>setTimeout(resolve,350));if(!changes.includes(path))throw new Error('实际文件监听未触发');
    const methods=Object.keys(platform);hidden.destroy();console.log(JSON.stringify({renderSmoke:true,pdfBytes:pdf.length,imageBytes:pngs[0].length,pngWidth:pngs[0].readUInt32BE(16),longImageParts:parts.length,jpeg:true,pdfMetadata:true,watcher:true,platformMethods:methods.length,platformCache:true,directory}));clearTimeout(timeout);app.exit(0);
  }catch(error){console.error(error);clearTimeout(timeout);app.exit(1);}
});
