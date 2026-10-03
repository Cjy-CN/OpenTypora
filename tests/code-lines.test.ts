// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import hljs from 'highlight.js';
import {numberedHighlightedCode} from '../src/render/code-lines';

function parseLines(source:string){
  const code=document.createElement('code');code.innerHTML=numberedHighlightedCode(source);
  return {code,lines:[...code.children] as HTMLSpanElement[]};
}

describe('numbered highlighted code',()=>{
  it('keeps a real multiline comment highlighted on every flat numbered line',()=>{
    const source='/* first\nsecond\nthird */\n';
    const highlighted=hljs.highlight(source,{language:'javascript'}).value;
    const {code,lines}=parseLines(highlighted);
    expect(lines.map(line=>line.dataset.line)).toEqual(['1','2','3']);
    expect(lines.map(line=>line.textContent)).toEqual(['/* first','second','third */']);
    expect(lines.every(line=>line.querySelector('.hljs-comment')?.textContent===line.textContent)).toBe(true);
    expect(code.querySelectorAll('.code-line .code-line')).toHaveLength(0);
    expect([...code.childNodes].every(node=>node.nodeType===Node.ELEMENT_NODE)).toBe(true);
  });

  it('copies nested token classes and styles without losing escaped code',()=>{
    const {lines}=parseLines('<span class="outer" style="font-weight: 700"><span class="inner">&lt;a&gt;\n&amp;b</span></span>');
    expect(lines.map(line=>line.textContent)).toEqual(['<a>','&b']);
    for(const line of lines){
      expect(line.querySelector('.outer')?.getAttribute('style')).toBe('font-weight: 700');
      expect(line.querySelector('.outer > .inner')?.textContent).toBe(line.textContent);
      expect(line.querySelector('a')).toBeNull();
    }
  });

  it('retains empty source lines and removes exactly one conventional final newline',()=>{
    expect(parseLines('a\n\n\n').lines.map(line=>line.textContent)).toEqual(['a',' ',' ']);
    expect(parseLines('<span class="hljs-comment">a\n</span>').lines.map(line=>line.textContent)).toEqual(['a']);
    expect(parseLines('a\nb').lines.map(line=>line.textContent)).toEqual(['a','b']);
    expect(parseLines('').lines.map(line=>line.textContent)).toEqual([' ']);
  });

  it('keeps adjacent highlighted tokens within their original source line',()=>{
    const {lines}=parseLines('<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;\n\n<span class="hljs-keyword">return</span> x;\n');
    expect(lines.map(line=>line.textContent)).toEqual(['const x = 1;',' ','return x;']);
    expect(lines[0].querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(lines[0].querySelector('.hljs-number')?.textContent).toBe('1');
  });
});
