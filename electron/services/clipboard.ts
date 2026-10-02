import { clipboard, ClipboardItem, nativeImage } from 'electron';
import { serviceError, string } from './validation';
export async function readClipboard():Promise<{text:string;html:string;image?:string;files?:string[]}>{
  const result:{text:string;html:string;image?:string;files?:string[]}={text:await clipboard.readText(),html:''};
  for(const item of await clipboard.read()){
    if(item.types.includes('text/html'))result.html=await (await item.getType('text/html')).text();
    const imageType=item.types.find(type=>/^image\//.test(type));if(imageType){const blob=await item.getType(imageType) as Blob;const image=nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));if(!image.isEmpty())result.image=image.toDataURL();}
    if(item.types.includes('text/uri-list'))result.files=(await(await item.getType('text/uri-list')).text()).split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
  }return result;
}
export async function writeClipboard(options:Record<string,unknown>):Promise<void>{
  const payload:Record<string,string|Blob>={};
  if(options.text!==undefined)payload['text/plain']=string(options.text,'剪贴板文本',64_000_000);
  if(options.html!==undefined)payload['text/html']=string(options.html,'剪贴板HTML',128_000_000);
  if(options.image!==undefined){const value=string(options.image,'剪贴板图像',64_000_000);if(!/^data:image\/(png|jpeg|webp);base64,/i.test(value))throw serviceError('INVALID_IMAGE','剪贴板图像需要PNG/JPEG/WebP data URL');const image=nativeImage.createFromDataURL(value);if(image.isEmpty())throw serviceError('INVALID_IMAGE','无法解码图片');payload['image/png']=new Blob([new Uint8Array(image.toPNG())],{type:'image/png'});}
  if(!Object.keys(payload).length)throw serviceError('INVALID_ARGUMENT','剪贴板写入内容不能为空');await clipboard.write([new ClipboardItem(payload)]);
}
