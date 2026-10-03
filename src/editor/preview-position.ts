import { markdownLanguage } from '@codemirror/lang-markdown';
/** Rendered text is a view. This map discards syntax while retaining canonical UTF-16 positions. */
export function renderedTextPosition(source:string,visible:string,offset:number):number|null {
  const skipped:{from:number;to:number}[]=[];
  markdownLanguage.parser.parse(source).iterate({enter(node){if(node.name.endsWith('Mark')||['TaskMarker','CodeInfo','TableDelimiter','LinkTitle','HTMLTag'].includes(node.name)||node.name==='URL'&&node.node.parent?.name!=='Autolink')skipped.push({from:node.from,to:node.to});}});
  skipped.sort((a,b)=>a.from-b.from);
  const characters:{value:string;offset:number}[]=[];let range=0;
  for(let index=0;index<source.length;index++){
    while(skipped[range]&&skipped[range].to<=index)range++;if(skipped[range]&&skipped[range].from<=index&&index<skipped[range].to)continue;
    if(source[index]==='\\'&&/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[index+1]??''))continue;
    const entity=source.slice(index).match(/^&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/i);if(entity){const value=entity[0],names:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"},number=value[2]?.toLowerCase()==='x'?parseInt(value.slice(3,-1),16):value[1]==='#'?parseInt(value.slice(2,-1),10):undefined;let decoded=names[value.toLowerCase()];if(number!==undefined&&number>=0&&number<=0x10ffff)decoded=String.fromCodePoint(number);if(decoded){for(let part=0;part<decoded.length;part++)characters.push({value:decoded[part],offset:index});index+=value.length-1;continue;}}
    if(!/\s/.test(source[index]))characters.push({value:source[index],offset:index});
  }
  let target=0;for(let index=0;index<Math.min(offset,visible.length);index++)if(!/\s/.test(visible[index]))target++;
  const rendered=visible.replace(/\s/g,'');let position=0,last=0;
  const sourceOffset=(next:number)=>{
    if(target===0||!(/\s/.test(visible[offset]??'')&&offset<visible.length))return next;
    let start=offset;while(start>0&&/\s/.test(visible[start-1]))start--;
    const spaces:number[]=[];for(let index=last+1;index<next;index++)if(/\s/.test(source[index])&&!skipped.some(range=>index>=range.from&&index<range.to))spaces.push(index);
    return spaces[Math.min(offset-start,spaces.length-1)]??Math.min(source.length,last+1);
  };
  for(let index=0;index<rendered.length;index++){
    while(position<characters.length&&characters[position].value!==rendered[index])position++;
    if(position===characters.length)return index===target?Math.min(source.length,last+1):null;
    if(index===target)return sourceOffset(characters[position].offset);last=characters[position++].offset;
  }
  return target>=rendered.length?Math.min(source.length,last+1):null;
}
export function hitRenderedText(element:HTMLElement,x:number,y:number,source:string):number|null {
  const documentApi=document as Document&{caretPositionFromPoint?:(x:number,y:number)=>{offsetNode:Node;offset:number}|null;caretRangeFromPoint?:(x:number,y:number)=>Range|null};
  const point=documentApi.caretPositionFromPoint?.(x,y),range=point?null:documentApi.caretRangeFromPoint?.(x,y),node=point?.offsetNode??range?.startContainer,offset=point?.offset??range?.startOffset;if(!node||offset===undefined||node.nodeType!==Node.TEXT_NODE||!element.contains(node))return null;
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let prefix='';while(walker.nextNode()){const text=walker.currentNode.textContent??'';if(walker.currentNode===node){prefix+=text.slice(0,offset);break;}prefix+=text;}
  return renderedTextPosition(source,element.textContent??'',prefix.length);
}
