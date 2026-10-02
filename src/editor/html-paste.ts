import DOMPurify from 'dompurify';
/** A detached, sanitized DOM is read for clipboard conversion. No document HTML executes. */
export function htmlToMarkdown(html:string):string {
  const clean=DOMPurify.sanitize(html,{FORBID_TAGS:['script','style','iframe','object','embed','form'],FORBID_ATTR:['style']}),document=new DOMParser().parseFromString(clean,'text/html');
  const escape=(value:string)=>value.replace(/([\\`*_[\]])/g,'\\$1');
  const convert=(node:Node,listDepth=0):string=>{
    if(node.nodeType===Node.TEXT_NODE)return escape(node.textContent??'');if(!(node instanceof Element))return '';
    const tag=node.tagName.toLowerCase(),children=()=>[...node.childNodes].map(child=>convert(child,listDepth)).join('');
    if(tag==='br')return '  \n';if(tag==='hr')return '\n\n---\n\n';if(/^h[1-6]$/.test(tag))return '\n\n'+'#'.repeat(Number(tag[1]))+' '+children().trim()+'\n\n';
    if(tag==='strong'||tag==='b')return '**'+children()+'**';if(tag==='em'||tag==='i')return '*'+children()+'*';if(tag==='s'||tag==='del')return '~~'+children()+'~~';if(tag==='u')return '<u>'+children()+'</u>';
    if(tag==='code'&&node.parentElement?.tagName!=='PRE'){const value=node.textContent??'',ticks='`'.repeat(Math.max(1,...(value.match(/`+/g)??[]).map(part=>part.length+1)));return ticks+value+ticks;}
    if(tag==='pre'){const code=node.querySelector('code'),value=code?.textContent??node.textContent??'',language=code?.className.match(/language-([^\s]+)/)?.[1]??'',ticks='`'.repeat(Math.max(3,...(value.match(/`+/g)??[]).map(part=>part.length+1)));return '\n\n'+ticks+language+'\n'+value.replace(/\n$/,'')+'\n'+ticks+'\n\n';}
    if(tag==='a'){const href=node.getAttribute('href')??'';return '['+children()+']('+href.replace(/\(/g,'\\(').replace(/\)/g,'\\)')+')';}
    if(tag==='img')return '!['+escape(node.getAttribute('alt')??'')+']('+(node.getAttribute('src')??'').replace(/\(/g,'\\(').replace(/\)/g,'\\)')+')';
    if(tag==='blockquote')return '\n\n'+children().trim().split('\n').map(line=>'> '+line).join('\n')+'\n\n';
    if(tag==='ul'||tag==='ol'){let number=Number(node.getAttribute('start')??1);return '\n'+[...node.children].filter(child=>child.tagName==='LI').map(item=>{const value=[...item.childNodes].map(child=>convert(child,listDepth+1)).join('').trim();return '  '.repeat(listDepth)+(tag==='ol'?`${number++}. `:'- ')+value.replace(/\n(?!\n)/g,'\n'+'  '.repeat(listDepth+1));}).join('\n')+'\n';}
    if(tag==='table'){const rows=[...node.querySelectorAll('tr')].map(row=>[...row.children].filter(cell=>['TH','TD'].includes(cell.tagName)).map(cell=>[...cell.childNodes].map(child=>convert(child)).join('').replace(/\|/g,'\\|').replace(/\n/g,'<br>')));if(!rows.length)return '';const width=Math.max(...rows.map(row=>row.length));const line=(row:string[])=>'| '+Array.from({length:width},(_,index)=>row[index]??'').join(' | ')+' |';return '\n\n'+[line(rows[0]),line(Array(width).fill('---')),...rows.slice(1).map(line)].join('\n')+'\n\n';}
    const content=children();if(['p','div','section','article'].includes(tag))return '\n\n'+content+'\n\n';return content;
  };
  return [...document.body.childNodes].map(node=>convert(node)).join('').replace(/\n{3,}/g,'\n\n').trim();
}
