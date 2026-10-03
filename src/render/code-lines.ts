/** Split trusted syntax-highlighted HTML into flat lines, retaining each token's inline styles. */
export function numberedHighlightedCode(highlightedHtml:string):string {
  const template=document.createElement('template');template.innerHTML=highlightedHtml;
  const lines:HTMLSpanElement[]=[];
  const newLine=()=>{const line=document.createElement('span');line.className='code-line';line.dataset.line=String(lines.length+1);lines.push(line);return line;};
  let current=newLine();
  const appendText=(value:string,ancestors:HTMLElement[])=>{
    const parts=value.split('\n');
    for(let index=0;index<parts.length;index++){
      if(index)current=newLine();
      if(!parts[index])continue;
      let content:Node=document.createTextNode(parts[index]);
      for(let ancestor=ancestors.length-1;ancestor>=0;ancestor--){
        const original=ancestors[ancestor],span=document.createElement('span');
        for(const name of ['class','style'])if(original.hasAttribute(name))span.setAttribute(name,original.getAttribute(name)!);
        span.append(content);content=span;
      }
      current.append(content);
    }
  };
  const walk=(node:Node,ancestors:HTMLElement[])=>{
    if(node.nodeType===Node.TEXT_NODE){appendText(node.textContent??'',ancestors);return;}
    const next=node instanceof HTMLElement&&node.tagName==='SPAN'?[...ancestors,node]:ancestors;
    for(const child of node.childNodes)walk(child,next);
  };
  for(const node of template.content.childNodes)walk(node,[]);
  // A fence's conventional last newline does not create an extra numbered source line.
  if(template.content.textContent?.endsWith('\n')&&lines.length>1)lines.pop();
  for(const line of lines)if(!line.childNodes.length)line.append(document.createTextNode(' '));
  // display:block supplies the visual line breaks; separator text would add blank rows in <pre>.
  return lines.map(line=>line.outerHTML).join('');
}
