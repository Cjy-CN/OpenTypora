import {expect,it} from 'vitest';
import {renderMathSvg} from '../src/render/math';
it('produces standalone vector formulae and optional physics notation',()=>{const svg=renderMathSvg('\\frac{x^2}{y}',true,false,false);expect(svg).toContain('<svg');expect(svg).toContain('<path');expect(svg).not.toContain('foreignObject');expect(renderMathSvg('\\bra{a}\\ket{b}',false,true,false)).toContain('<svg');});
