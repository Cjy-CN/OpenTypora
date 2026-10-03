import { describe,expect,it } from 'vitest';
import { applyPlan } from '../core/formatting';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { assistInput,deleteMatchingPair,newlineBetweenFences,alignedNewline } from './input-assistance';
import { DocumentStore,createDocument } from '../core/document';
import { commitPlan } from './commands';
import { SourceProjection } from './source-projection';
describe('input assistance boundaries',()=>{
  it('wraps a Unicode selection and supports paired deletion independently of Markdown pairing',()=>{const text='😀中文',plan=assistInput(text,0,text.length,'(',DEFAULT_SETTINGS)!;expect(applyPlan(text,plan)).toBe('(😀中文)');expect(plan.selection).toEqual({anchor:1,head:5});expect(applyPlan('()',deleteMatchingPair('()',{anchor:1,head:1},DEFAULT_SETTINGS)!)).toBe('');expect(assistInput('',0,0,'*',DEFAULT_SETTINGS)).toBeNull();});
  it('does not interfere with composition, escaped input or apostrophes in words',()=>{expect(assistInput('',0,0,'(',DEFAULT_SETTINGS,true)).toBeNull();expect(deleteMatchingPair('()',{anchor:1,head:1},DEFAULT_SETTINGS,true)).toBeNull();expect(assistInput('\\',1,1,'(',DEFAULT_SETTINGS)).toBeNull();expect(assistInput('don',3,3,"'",DEFAULT_SETTINGS)).toBeNull();});
  it('grows matched Markdown markers for bold and fences instead of leaving the caret outside',()=>{const settings={...DEFAULT_SETTINGS,'editor.matchMarkdown':true};const first=assistInput('',0,0,'*',settings)!,one=applyPlan('',first),second=assistInput(one,1,1,'*',settings)!;expect(applyPlan(one,second)).toBe('****');expect(second.selection.head).toBe(2);const fence=assistInput('````',2,2,'`',settings)!;expect(applyPlan('````',fence)).toBe('``````');const newline=newlineBetweenFences('``````',{anchor:3,head:3})!;expect(applyPlan('``````',newline)).toBe('```\n\n```');});
  it('keeps quotes and dashes literal in code and render-only mode',()=>{const settings={...DEFAULT_SETTINGS,'markdown.smartQuotes':true,'markdown.smartDashes':true};expect(assistInput('```js\n-',7,7,'-',settings)).toBeNull();expect(assistInput('hello',5,5,'"',{...settings,'markdown.smartMode':'render','editor.matchBrackets':false})).toBeNull();expect(applyPlan('-',assistInput('-',1,1,'-',settings)!)).toBe('–');expect(applyPlan('–',assistInput('–',1,1,'-',settings)!)).toBe('—');});
  it('honors pair settings when only Markdown markers are enabled',()=>{const settings={...DEFAULT_SETTINGS,'editor.matchBrackets':false,'editor.matchMarkdown':true};expect(assistInput('',0,0,'(',settings)).toBeNull();expect(applyPlan('',assistInput('',0,0,'=',settings)!)).toBe('==');});
});

describe('Enter indentation alignment',()=>{
  const aligned={...DEFAULT_SETTINGS,'editor.alignIndent':true};
  it('inherits the current space/tab indentation only while its setting is enabled',()=>{
    for(const indent of ['  ','\t',' \t  ']){
      const text=indent+'text',selection={anchor:text.length,head:text.length};
      expect(alignedNewline(text,selection,DEFAULT_SETTINGS)).toBeNull();
      const result=alignedNewline(text,selection,aligned,false,'\n')!;
      expect(applyPlan(text,result)).toBe(text+'\n'+indent);expect(result.selection.head).toBe(text.length+1+indent.length);
    }
  });
  it('preserves UTF-16 selection offsets and makes alignment one undoable DocumentStore transaction',()=>{
    const text='  😀中文',store=new DocumentStore(createDocument(text));
    store.setSelection({anchor:text.length,head:text.length});
    const result=alignedNewline(text,store.getSnapshot().selection,aligned,false,'\n')!;
    expect(result.changes).toEqual([{from:6,to:6,insert:'\n  '}]);
    expect(commitPlan(store,result,'input')).toBe(true);expect(store.getSnapshot().text).toBe('  😀中文\n  ');
    expect(store.getSnapshot().version).toBe(1);expect(store.getSnapshot().selection.head).toBe(9);
    store.undo();expect(store.getSnapshot().text).toBe(text);store.redo();expect(store.getSnapshot().text).toBe('  😀中文\n  ');
  });
  it('replaces forward/backward selections without duplicating existing suffix indentation',()=>{
    const text='  abc\n tail',from=3,to=8;
    for(const selection of [{anchor:from,head:to},{anchor:to,head:from}]){
      const result=alignedNewline(text,selection,aligned,false,'\n')!;
      expect(applyPlan(text,result)).toBe('  a\n  ail');expect(result.selection).toEqual({anchor:6,head:6});
    }
    const result=alignedNewline('  word',{anchor:1,head:1},aligned,false,'\n')!;
    expect(applyPlan('  word',result)).toBe(' \n  word');
  });
  it('uses actual CRLF/CR line endings or the new-document default without changing existing source',()=>{
    for(const newline of ['\r\n','\r','\n']){
      const text='first'+newline+'  😀',position=text.length,result=alignedNewline(text,{anchor:position,head:position},aligned)!;
      expect(result.changes[0].insert).toBe(newline+'  ');expect(result.selection.head).toBe(position+newline.length+2);
      expect(applyPlan(text,result)).toBe(text+newline+'  ');
    }
    expect(alignedNewline('',{anchor:0,head:0},aligned)!.changes[0].insert).toBe('\r\n');
    expect(alignedNewline('a\r\nb',{anchor:2,head:2},aligned)).toBeNull();
  });
  it('supports explicit LF projection and round-trips its changes back to CRLF source',()=>{
    const source='a\r\n  😀',projection=new SourceProjection(source),selection={anchor:projection.text.length,head:projection.text.length};
    const result=alignedNewline(projection.text,selection,aligned,false,'\n')!;
    const changes=projection.changesToSource(result.changes,'CRLF');
    expect(changes).toEqual([{from:source.length,to:source.length,insert:'\r\n  '}]);
    expect(applyPlan(source,{changes,selection:{anchor:0,head:0}})).toBe(source+'\r\n  ');
    expect(alignedNewline('',{anchor:0,head:0},aligned,false,'\n')!.selection.head).toBe(1);
  });
  it('leaves list/task/quote continuation and fence-pair expansion to the existing commands',()=>{
    for(const text of ['1. item','- item','  - [ ] task','> quote','  > quote','```js','~~~js','``````']){
      const position=text==='``````'?3:text.length;
      expect(alignedNewline(text,{anchor:position,head:position},aligned)).toBeNull();
    }
    const text='a\r\n``````',position=6,result=newlineBetweenFences(text,{anchor:position,head:position})!;
    expect(applyPlan(text,result)).toBe('a\r\n```\r\n\r\n```');expect(result.selection.head).toBe(position+2);
  });
  it('expands paired code delimiters using code indentation and preserves tabs',()=>{
    const text='```js\n  const x = {}\n```',position=text.indexOf('{}')+1,result=alignedNewline(text,{anchor:position,head:position},aligned)!;
    expect(applyPlan(text,result)).toBe('```js\n  const x = {\n      \n  }\n```');
    expect(result.selection.head).toBe(position+7);
    const tabs='```js\n\t{}\n```',tabPosition=tabs.indexOf('{}')+1;
    expect(alignedNewline(tabs,{anchor:tabPosition,head:tabPosition},aligned)!.changes[0].insert).toBe('\n\t\t\n\t');
    const custom=alignedNewline(text,{anchor:position,head:position},{...aligned,'code.indent':2})!;
    expect(custom.changes[0].insert).toBe('\n    \n  ');
  });
  it('does not expand ordinary Markdown or quoted code delimiters',()=>{
    const plain='  {}',position=3;expect(alignedNewline(plain,{anchor:position,head:position},aligned,false,'\n')!.changes[0].insert).toBe('\n  ');
    const code='```js\n  const s = "{}";\n```',where=code.indexOf('{}')+1;
    expect(alignedNewline(code,{anchor:where,head:where},aligned)!.changes[0].insert).toBe('\n  ');
  });
  it('never adds an edit while IME composition is active and respects readonly Store commits',()=>{
    const text='  中文',selection={anchor:text.length,head:text.length};
    expect(alignedNewline(text,selection,aligned,true)).toBeNull();
    expect(newlineBetweenFences('``````',{anchor:3,head:3},true)).toBeNull();
    const store=new DocumentStore(createDocument(text));store.patchMetadata({readonly:true});
    expect(commitPlan(store,alignedNewline(text,selection,aligned)!,'input')).toBe(false);expect(store.getSnapshot().text).toBe(text);
  });
});
