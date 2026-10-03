// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {markdownBlocks} from '../src/core/formatting';
import {DEFAULT_SETTINGS} from '../src/shared/settings';
import {renderMarkdown} from '../src/render/markdown';
import {footnoteReferencePositions,liveFootnoteTarget,liveReferences,previewReplacementEnd,renderLiveBlock} from '../src/editor/live-render';

const settings={...DEFAULT_SETTINGS};
function fragment(html:string){const template=document.createElement('template');template.innerHTML=html;return template.content;}

describe('live whitespace projection',()=>{
  for(const newline of ['\n','\r\n','\r'])it(`absorbs inactive blank separators with ${JSON.stringify(newline)} without changing source`,()=>{
    const text=`第一段 🙂${newline}${newline}  ${newline}\t${newline}第二段`,[first,second]=markdownBlocks(text),before=text;
    expect(previewReplacementEnd(text,first,{anchor:second.from,head:second.from})).toBe(second.from);
    expect(text).toBe(before);
  });
  it('keeps blank-line caret, selection and composing separators editable',()=>{
    const text='first\n\n  \nsecond',[first,second]=markdownBlocks(text),blank=first.to+1;
    expect(previewReplacementEnd(text,first,{anchor:blank,head:blank})).toBe(first.to);
    expect(previewReplacementEnd(text,first,{anchor:second.from+2,head:blank})).toBe(first.to);
    expect(previewReplacementEnd(text,first,{anchor:second.from,head:second.from},true)).toBe(first.to);
    expect(previewReplacementEnd(text,first,{anchor:second.from,head:second.from})).toBe(second.from);
  });
  it('absorbs trailing empty lines and spaces up to EOF',()=>{
    const text='first\n\n  ',[first]=markdownBlocks(text);
    expect(previewReplacementEnd(text,first,{anchor:0,head:0})).toBe(text.length);
    expect(previewReplacementEnd(text,first,{anchor:text.length-1,head:text.length-1})).toBe(first.to);
  });
});

describe('live hidden Markdown content',()=>{
  const text='[链接][reference]，引用[^note]，再次引用[^note]。\r\n\r\n另一个块[^note]。\r\n\r\n[reference]: https://example.com "示例链接"\r\n[^note]: 脚注正文，含 **强调**。';
  it('shows labels in references without repeating generated endnotes in each block',()=>{
    const blocks=markdownBlocks(text),first=fragment(renderLiveBlock(blocks[0],text,settings,null)),second=fragment(renderLiveBlock(blocks[1],text,settings,null));
    expect([...first.querySelectorAll('.ot-live-footnote-ref')].map(link=>link.textContent)).toEqual(['note','note']);
    expect(second.querySelector('.ot-live-footnote-ref')?.textContent).toBe('note');
    expect(first.querySelector('.footnotes,.footnotes-sep')).toBeNull();
    expect(second.querySelector('.footnotes,.footnotes-sep')).toBeNull();
    expect(first.querySelector('a[href="https://example.com"]')?.getAttribute('title')).toBe('示例链接');
    expect(first.textContent).not.toContain('脚注正文');
  });
  it('keeps definitions at source location and resolves every repeated back reference',()=>{
    const block=markdownBlocks(text)[2],html=fragment(renderLiveBlock(block,text,settings,null)),definitions=html.querySelectorAll('.ot-live-reference');
    expect(definitions[0].textContent).toBe('[reference]: https://example.com "示例链接"');
    expect(definitions[1].textContent).toContain('[^note]: 脚注正文，含 强调。');
    expect(definitions[1].querySelector('strong')?.textContent).toBe('强调');
    const backlinks=[...html.querySelectorAll<HTMLElement>('.ot-live-footnote-backref')];
    expect(backlinks.map(link=>liveFootnoteTarget(text,link))).toEqual(footnoteReferencePositions(text,'note'));
    expect(backlinks).toHaveLength(3);
    const reference=fragment(renderLiveBlock(markdownBlocks(text)[0],text,settings,null)).querySelector<HTMLElement>('.ot-live-footnote-ref')!;
    expect(liveFootnoteTarget(text,reference)).toBe(text.indexOf('[^note]:'));
    expect(liveFootnoteTarget('🙂\r\n'+text,reference)).toBe(('🙂\r\n'+text).indexOf('[^note]:'));
  });
  it('does not collect escaped references or code literals as return destinations',()=>{
    const source='\\[^note] `[^note]` 真正[^note]\n\n```md\n[^note]\n[fake]: https://fake.test\n```\n\n[^note]: real';
    expect(footnoteReferencePositions(source,'note')).toEqual([source.indexOf('真正')+2]);
    expect(liveReferences(source)).not.toContain('[fake]');
    const html=fragment(renderLiveBlock(markdownBlocks(source)[0],source,settings,null));
    expect(html.querySelectorAll('.ot-live-footnote-ref')).toHaveLength(1);
    expect(html.querySelector('code')?.textContent).toBe('[^note]');
  });
  it('renders HTML comments as escaped live source while preserving code comment literals',()=>{
    const source='<!-- 保留注释，<img src=x onerror=alert(1)> -->',block=markdownBlocks(source)[0],html=fragment(renderLiveBlock(block,source,settings,null));
    expect(html.querySelector('.ot-live-comment')?.textContent).toBe(source);
    expect(html.querySelector('img')).toBeNull();
    expect(renderMarkdown(source,settings)).not.toContain('保留注释');
    const code='```html\n<!-- literal -->\n```',codeHtml=fragment(renderLiveBlock(markdownBlocks(code)[0],code,settings,null));
    expect(codeHtml.querySelector('.ot-live-comment')).toBeNull();
    expect(codeHtml.textContent).toContain('<!-- literal -->');
  });
  it('keeps normal document export numeric with a single endnote section',()=>{
    const html=fragment(renderMarkdown(text,settings));
    expect(html.querySelectorAll('.footnotes')).toHaveLength(1);
    expect(html.querySelectorAll('.footnote-item')).toHaveLength(1);
    expect(html.querySelector('.footnote-ref a')?.textContent).toBe('[1]');
    expect(html.querySelector('.ot-live-reference')).toBeNull();
  });
});
