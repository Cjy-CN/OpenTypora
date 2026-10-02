import { BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RenderService } from './export';
import { number, serviceError } from './validation';
import { pdfMetadata } from './pdf-metadata';
function inch(value:unknown,fallback:number):number{if(value===undefined||value==='')return fallback;if(typeof value==='number')return number(value,fallback,0,10);const match=String(value).match(/^([\d.]+)\s*(mm|cm|in|px)?$/);if(!match)throw serviceError('INVALID_MARGIN','边距格式应为数值英寸或带 mm/cm/in/px 单位');const amount=Number(match[1]);return number(amount/(match[2]==='mm'?25.4:match[2]==='cm'?2.54:match[2]==='px'?96:1),fallback,0,10);}
export function pdfOptions(options:Record<string,unknown>):Electron.PrintToPDFOptions{
  const margin=options.margins;let margins:Electron.PrintToPDFMargins={top:0.4,bottom:0.4,left:0.4,right:0.4};if(margin&&typeof margin==='object'){const values=margin as Record<string,unknown>;margins={top:inch(values.top,.4),bottom:inch(values.bottom,.4),left:inch(values.left,.4),right:inch(values.right,.4)};}else if(margin&&margin!=='default'){const value=inch(margin,.4);margins={top:value,bottom:value,left:value,right:value};}
  const allowed=['A0','A1','A2','A3','A4','A5','A6','Legal','Letter','Tabloid','Ledger'];const page=String(options.pageSize||'A4');if(!allowed.includes(page))throw serviceError('INVALID_PAGE_SIZE','请选择支持的页面尺寸');
  return{pageSize:page as Electron.PrintToPDFOptions['pageSize'],margins,printBackground:true,landscape:options.landscape===true,displayHeaderFooter:!!(options.header||options.footer),headerTemplate:String(options.header||'<span></span>'),footerTemplate:String(options.footer||'<span></span>'),generateDocumentOutline:true,generateTaggedPDF:true,scale:number(options.scale,1,.1,2)};
}
export function createRenderService(userData:string):RenderService{
  const withWindow=async<T>(html:string,width:number,height:number,signal:AbortSignal|undefined,operation:(window:BrowserWindow)=>Promise<T>):Promise<T>=>{
    const directory=join(userData,'render',randomUUID());await fs.mkdir(directory,{recursive:true});const path=join(directory,'export.html');
    // Export documents never receive a preload/Node bridge; CSP prevents scripts and network connections.
    const csp="default-src 'none'; script-src 'none'; connect-src 'none'; style-src 'unsafe-inline' file: data:; img-src data: file: https: http:; font-src data: file:;";
    await fs.writeFile(path,html.replace(/<head>/i,`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`));
    const window=new BrowserWindow({show:false,width,height,useContentSize:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,javascript:true,spellcheck:false,backgroundThrottling:false}});
    const abort=()=>window.destroy();signal?.addEventListener('abort',abort,{once:true});
    try{if(signal?.aborted)throw serviceError('CANCELLED','导出已取消');window.webContents.setWindowOpenHandler(()=>({action:'deny'}));await window.loadFile(path);
      await window.webContents.executeJavaScript(`Promise.race([Promise.all([document.fonts.ready,...Array.from(document.images,img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=img.onerror=resolve}))]),new Promise(resolve=>setTimeout(resolve,10000))])`);
      if(signal?.aborted)throw serviceError('CANCELLED','导出已取消');return await operation(window);
    }finally{signal?.removeEventListener('abort',abort);if(!window.isDestroyed())window.destroy();await fs.rm(directory,{recursive:true,force:true});}
  };
  return{
    pdf:(html,options,signal)=>withWindow(html,1000,900,signal,async window=>pdfMetadata(await window.webContents.printToPDF(pdfOptions(options)),{author:String(options.author||''),title:String(options.title||'')})),
    image:(html,options,signal)=>withWindow(html,Math.round(number(options.imageWidth,640,100,8192)),800,signal,async window=>{
      const width=Math.round(number(options.imageWidth,640,100,8192)),rawQuality=options.imageQuality,quality=Math.round(number(typeof rawQuality==='number'&&rawQuality>0&&rawQuality<=1?rawQuality*100:rawQuality,90,1,100));
      const height=Math.ceil(await window.webContents.executeJavaScript('Math.max(document.documentElement.scrollHeight,document.body.scrollHeight)'));
      if(height>500_000)throw serviceError('IMAGE_TOO_LONG','图片高度超过500000像素，请按章节导出');const images:Buffer[]=[];
      for(let y=0;y<height;y+=16_000){if(signal?.aborted)throw serviceError('CANCELLED','导出已取消');const part=Math.min(16_000,height-y);window.setContentSize(width,part);await window.webContents.executeJavaScript(`window.scrollTo(0,${y}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);const capture=await window.webContents.capturePage({x:0,y:0,width,height:part});if(capture.isEmpty())throw serviceError('IMAGE_CAPTURE_FAILED','渲染引擎未返回图片，请重试');images.push(String(options.imageFormat||'png')==='jpeg'?capture.toJPEG(quality):capture.toPNG());}return images;
    })
  };
}
