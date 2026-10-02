import { codeAt,orderedSelection,type EditPlan } from '../core/formatting';
import type { SelectionRange } from '../shared/contracts';
import type { SettingsSnapshot } from '../shared/settings';
function plan(from:number,to:number,insert:string,anchor:number,head=anchor):EditPlan{return {changes:[{from,to,insert}],selection:{anchor,head}};}
function enabledPairs(settings:SettingsSnapshot,code:boolean):Record<string,string>{return {...(settings['editor.matchBrackets']?{'(':')','[':']','{':'}','"':'"',"'":"'"}:{}),...(settings['editor.matchMarkdown']&&!code?{'*':'*','_':'_','`':'`','~':'~','=':'='}:{})};}
/** Input helpers operate on whichever UTF-16 projection the caller supplies, and never run during IME. */
export function assistInput(text:string,from:number,to:number,input:string,settings:SettingsSnapshot,composing=false):EditPlan|null {
  if(composing)return null;const start=text.lastIndexOf('\n',from-1)+1,end=text.indexOf('\n',from),line=text.slice(start,end<0?text.length:end),fencePair=/^`+$/.test(line)&&from-start===line.length/2,code=!!codeAt(text,from)&&!fencePair,previous=text[from-1]??'',next=text[from]??'';
  if(!code&&settings['markdown.smartMode']==='input'){
    if(settings['markdown.smartQuotes']&&(input==='"'||input==="'")){const opening=from===0||/[\s([{—]/.test(previous),insert=input==='"'?(opening?'“':'”'):(opening?'‘':'’');return plan(from,to,insert,from+insert.length);}
    if(settings['markdown.smartDashes']&&input==='-'&&(previous==='-'||previous==='–'))return plan(from-1,to,previous==='-'?'–':'—',from);
  }
  if(input.length!==1||previous==='\\')return null;const pairs=enabledPairs(settings,code),close=pairs[input];
  if(close){
    if(input==="'"&&/[\p{L}\p{N}]/u.test(previous))return null;
    const selected=text.slice(from,to);
    if(!selected&&next===input&&'"\'*_`~='.includes(input)){
      // Consecutive Markdown openers grow both sides: *|* → **|** and ``|`` → ```|```.
      if('*_`~='.includes(input)&&previous===input)return plan(from,to,input+input,from+1);
      return {changes:[],selection:{anchor:from+1,head:from+1}};
    }
    return plan(from,to,input+selected+close,from+1,from+1+selected.length);
  }
  if(settings['editor.matchBrackets']&&')]}'.includes(input)&&next===input)return {changes:[],selection:{anchor:from+1,head:from+1}};
  return null;
}
export function deleteMatchingPair(text:string,selection:SelectionRange,settings:SettingsSnapshot,composing=false):EditPlan|null {
  if(composing||selection.anchor!==selection.head)return null;const position=selection.head,pairs=enabledPairs(settings,!!codeAt(text,position)),open=text[position-1],close=text[position];if(pairs[open]!==close||!open||text[position-2]==='\\')return null;return plan(position-1,position+1,'',position-1);
}
export function newlineBetweenFences(text:string,selection:SelectionRange):EditPlan|null {
  const {from,to}=orderedSelection(selection);if(from!==to)return null;const before=text.slice(0,from),lineStart=before.lastIndexOf('\n')+1,prefix=text.slice(lineStart,from),suffix=text.slice(from).split('\n')[0];if(!/^`{3,}$/.test(prefix)||prefix!==suffix)return null;return plan(from,from,'\n\n',from+1);
}
