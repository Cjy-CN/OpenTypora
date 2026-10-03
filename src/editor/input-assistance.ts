import { codeAt,lineAt,orderedSelection,preferredNewline,type EditPlan } from '../core/formatting';
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
export function newlineBetweenFences(text:string,selection:SelectionRange,composing=false,newline=preferredNewline(text,'LF')):EditPlan|null {
  const {from,to}=orderedSelection(selection);if(composing||from!==to)return null;const line=lineAt(text,from),prefix=text.slice(line.from,from),suffix=text.slice(from,line.to);if(!/^`{3,}$/.test(prefix)||prefix!==suffix)return null;return plan(from,from,newline+newline,from+newline.length);
}

/**
 * Enter alignment is one source edit. Pass '\n' explicitly when working in CodeMirror's LF
 * projection; otherwise this helper uses the document's existing/default newline convention.
 * List and quote markers remain the responsibility of insertNewlineContinueMarkup.
 */
export function alignedNewline(text:string,selection:SelectionRange,settings:SettingsSnapshot,composing=false,newline=preferredNewline(text,settings['editor.lineEnding'])):EditPlan|null {
  if(composing||!settings['editor.alignIndent'])return null;
  const {from,to}=orderedSelection(selection);
  if(from<0||to>text.length||text[from-1]==='\r'&&text[from]==='\n'||text[to-1]==='\r'&&text[to]==='\n')return null;
  const line=lineAt(text,from),prefix=text.slice(line.from,from),indent=prefix.match(/^[ \t]*/)![0];
  const code=codeAt(text,from);
  if(!code&&/^[ \t]*(?:>|[-+*][ \t]+|\d{1,9}[.)][ \t]+)/.test(line.text))return null;
  if(/^[ \t]*(?:`{3,}|~{3,})/.test(line.text)||newlineBetweenFences(text,selection,false,newline))return null;
  let insert=newline+indent;
  // For a literal paired code delimiter, place the caret on the inner indented line.
  // Quoted delimiters stay literal and inherit indentation without expanding a string.
  if(code&&from===to&&from>=code.contentFrom&&from<=code.contentTo){
    const open=prefix.at(-1)??'',close=text[from]??'',pairs:Record<string,string>={'{':'}','[':']','(':')'};
    let quote='',escaped=false;
    for(const char of prefix.slice(0,-1)){
      if(escaped){escaped=false;continue;}
      if(char==='\\'){escaped=true;continue;}
      if(quote){if(char===quote)quote='';}
      else if('"\'`'.includes(char))quote=char;
    }
    if(!quote&&pairs[open]===close){
      const unit=indent.includes('\t')?'\t':' '.repeat(settings['code.indent']);
      insert=newline+indent+unit+newline+indent;
      return plan(from,to,insert,from+newline.length+indent.length+unit.length);
    }
  }
  return plan(from,to,insert,from+insert.length);
}
