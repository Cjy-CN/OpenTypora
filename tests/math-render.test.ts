import {describe,expect,it} from 'vitest';
import {renderMathSvg} from '../src/render/math';

const equationIds=(svg:string)=>[...svg.matchAll(/\bid="mjx-eqn:([^"]+)"/g)].map(match=>match[1]);

describe('document-local MathJax numbering',()=>{
  it('numbers ordinary display math at explicit positions and remains stable on refresh',()=>{
    const first=renderMathSvg('x=1',true,false,true,1);
    const second=renderMathSvg('y=2',true,false,true,2);
    expect(equationIds(first)).toEqual(['1']);
    expect(equationIds(second)).toEqual(['2']);
    expect(renderMathSvg('x=1',true,false,true,1)).toBe(first);
    expect(renderMathSvg('y=2',true,false,true,2)).toBe(second);
  });

  it('starts a new document at one after rendering another document',()=>{
    renderMathSvg('a=b',true,false,true,12);
    const source=String.raw`\begin{equation}x=1\end{equation}`;
    const documentA=renderMathSvg(source,true,false,true);
    renderMathSvg('c=d',true,false,true,2);
    expect(equationIds(documentA)).toEqual(['1']);
    expect(renderMathSvg(source,true,false,true)).toBe(documentA);
  });

  it('does not automatically number disabled or inline equations',()=>{
    const source=String.raw`\begin{equation}x=1\end{equation}`;
    expect(equationIds(renderMathSvg(source,true,false,false,3))).toEqual([]);
    expect(equationIds(renderMathSvg('x=1',false,false,true,3))).toEqual([]);
    expect(equationIds(renderMathSvg(source,false,false,true,3))).toEqual([]);
    expect(equationIds(renderMathSvg('x=1',true,false,true))).toEqual(['1']);
  });

  it('keeps Physics macro support independent of the numbering cache',()=>{
    const source=String.raw`\dv{f}{x}`;
    const enabled=renderMathSvg(source,true,true,true,2);
    expect(enabled).not.toContain('data-mml-node="merror"');
    expect(enabled).toContain('data-mml-node="mfrac"');
    expect(equationIds(enabled)).toEqual(['2']);
    expect(renderMathSvg(source,true,true,true,2)).toBe(enabled);
    const disabled=renderMathSvg(source,true,false,false);
    expect(disabled).not.toContain('data-mml-node="mfrac"');
    expect(disabled).toContain('fill="red"');
  });
});
