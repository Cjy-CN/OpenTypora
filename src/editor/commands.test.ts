import { describe,expect,it } from 'vitest';
import { DocumentStore,createDocument } from '../core/document';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { imageAt,imageReferences } from '../core/formatting';
import { EDITOR_COMMAND_IDS,executeTextCommand } from './commands';
describe('command source and resource contracts',()=>{
  it('does not claim unimplemented external commands are handled',()=>{const store=new DocumentStore(createDocument('text'));expect(executeTextCommand(store,'file.export',DEFAULT_SETTINGS)).toBe(false);expect(executeTextCommand(store,'table.rowAfter',DEFAULT_SETTINGS)).toBe(false);expect(executeTextCommand(store,'code.language',DEFAULT_SETTINGS,'js')).toBe(false);});
  it('implements all advertised pure text commands against suitable contexts',()=>{
    const commands=EDITOR_COMMAND_IDS.filter(id=>!id.startsWith('edit.')&&!['format.link','format.linkActions','code.copy','table.copy','image.scale','image.convertSyntax'].includes(id));
    for(const id of commands){let text='hello 😀';if(id.startsWith('table.')&&id!=='table.create')text='| A | B |\n| --- | --- |\n| a | b |\n| c | d |';if(id.startsWith('code.')&&id!=='code.create')text='```js\nconst a = 1;\n```';if(id==='paragraph.taskState')text='- [ ] task';const store=new DocumentStore(createDocument(text));let position=id.startsWith('table.')?text.indexOf('b |'):id.startsWith('code.')?text.indexOf('const'):0;if(position<0)position=0;store.setSelection({anchor:position,head:position});const argument=id==='image.insert'?{url:'image.png'}:id==='table.alignment'?'right':id==='code.language'?'python':undefined;
      // Boundary moves may be intentionally inapplicable, never modify neighboring content.
      const result=executeTextCommand(store,id,DEFAULT_SETTINGS,argument);if(!result)expect(['table.moveRowDown','table.moveColumnRight','range.moveLineUp','range.moveLineDown']).toContain(id);
    }
  });
  it('provides exact URL ranges for Markdown, HTML and shared image reference definitions',()=>{
    const text='😀 ![alt](images/test(a).png "title")\r\n<img src="a&amp;b.png" alt="A" width="30"/>\n![另一][pic]\n[pic]: assets/中文.png\n\n`![fake](wrong.png)`\n```\n<img src="wrong.png">\n```';const images=imageReferences(text);expect(images).toHaveLength(3);expect(text.slice(images[0].urlFrom,images[0].urlTo)).toBe('images/test(a).png');expect(images[1].url).toBe('a&b.png');expect(images[2].syntax).toBe('reference');expect(text.slice(images[2].urlFrom,images[2].urlTo)).toBe('assets/中文.png');expect(imageAt(text,text.indexOf('alt'))).toEqual(images[0]);
  });
});
