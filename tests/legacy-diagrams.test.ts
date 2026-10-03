// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {renderFlowDiagram,renderLegacyDiagram,renderSequenceDiagram} from '../src/render/legacy-diagrams';

describe('Typora traditional diagrams',()=>{
  it('renders compact monochrome sequence SVG with actors, dashed response and note',()=>{const svg=renderSequenceDiagram('Title: Request\nparticipant Alice as A\nparticipant Bob as B\nA->B: Request\nB-->A: Response\nNote right of B: Done');expect(svg.startsWith('<svg')).toBe(true);expect(svg).toContain('Alice');expect(svg).toContain('Bob');expect(svg).toContain('stroke-dasharray="4 3"');expect(svg).toContain('Done');expect(svg).not.toContain('javascript:');});
  it('renders legacy flow nodes and labeled branches as black and white SVG',()=>{const svg=renderFlowDiagram('st=>start: Start\nop=>operation: Edit\ncond=>condition: Save?\ne=>end: End\nst->op->cond\ncond(yes)->e');expect(svg).toContain('<ellipse');expect(svg).toContain('<rect');expect(svg).toContain('Save?');expect(svg).toContain('yes');expect(svg).toContain('stroke="#333"');expect(svg).not.toContain('#e9e9');});
  it('keeps unknown or hostile labels as text only',()=>{const svg=renderLegacyDiagram('flow','a=>operation: <img src=x onerror=alert(1)>\nb=>end: Done\na->b');expect(svg).toContain('&lt;img');expect(svg).not.toContain('<img');expect(svg).not.toContain('<img ');});
});
