import { describe,expect,it } from 'vitest';
import { renderedTextPosition } from './preview-position';
describe('rendered click positions',()=>{
  it('maps visible text through emphasis, links and a heading prefix',()=>{const source='# **中文** [链接](https://example.com) 😀后文',visible='中文 链接 😀后文\n';expect(renderedTextPosition(source,visible,visible.indexOf('链接'))).toBe(source.indexOf('链接'));expect(renderedTextPosition(source,visible,visible.indexOf('后文'))).toBe(source.indexOf('后文'));});
  it('maps list text and ignores generated whitespace between list tags',()=>{const source='- [ ] 第一项\n- [x] **第二项**',visible='\n第一项\n第二项\n';expect(renderedTextPosition(source,visible,visible.indexOf('第二项'))).toBe(source.indexOf('第二项'));});
  it('maps entity and escaped text to original UTF-16 offsets',()=>{const source='A &amp; \\* 😀中文',visible='A & * 😀中文';expect(renderedTextPosition(source,visible,visible.indexOf('&'))).toBe(source.indexOf('&amp;'));expect(renderedTextPosition(source,visible,visible.indexOf('*'))).toBe(source.indexOf('*'));expect(renderedTextPosition(source,visible,visible.indexOf('中文'))).toBe(source.indexOf('中文'));});
  it('keeps literal Markdown syntax inside code when resolving a click',()=>{const source='```js\n**literal**\n```',visible='**literal**\n';expect(renderedTextPosition(source,visible,visible.indexOf('literal'))).toBe(source.indexOf('literal'));});
});
