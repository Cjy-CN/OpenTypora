import { serviceError } from './validation';
/** Append an incremental metadata update to Chromium's classic-xref PDF without rewriting its page streams. */
export function pdfMetadata(pdf:Buffer,metadata:{author?:string;title?:string}):Buffer{
  if(!metadata.author&&!metadata.title)return pdf;const tail=pdf.subarray(Math.max(0,pdf.length-8192)).toString('latin1');
  const trailer=[...tail.matchAll(/trailer\s*<<([\s\S]*?)>>\s*startxref\s*(\d+)/g)].at(-1);const size=trailer?.[1].match(/\/Size\s+(\d+)/),root=trailer?.[1].match(/\/Root\s+(\d+\s+\d+\s+R)/);
  if(!trailer||!size||!root)throw serviceError('PDF_METADATA','渲染引擎PDF结构无法添加作者元数据');const id=Number(size[1]),previous=Number(trailer[2]);
  const hex=(text:string)=>`<FEFF${Buffer.from(text,'utf16le').swap16().toString('hex').toUpperCase()}>`;
  const info=Buffer.from(`\n${id} 0 obj\n<< /Producer (OpenTypora) ${metadata.author?`/Author ${hex(metadata.author)}`:''} ${metadata.title?`/Title ${hex(metadata.title)}`:''} >>\nendobj\n`,'ascii');
  const offset=pdf.length+1,xref=pdf.length+info.length;const table=Buffer.from(`xref\n${id} 1\n${String(offset).padStart(10,'0')} 00000 n \ntrailer\n<< /Size ${id+1} /Root ${root[1]} /Info ${id} 0 R /Prev ${previous} >>\nstartxref\n${xref}\n%%EOF\n`,'ascii');return Buffer.concat([pdf,info,table]);
}
