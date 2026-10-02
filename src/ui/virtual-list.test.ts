import {describe,it,expect} from 'vitest';
import {virtualRange} from './virtual-list';
describe('navigation virtualization',()=>{
 it('limits DOM rows independently of a ten-thousand-item directory',()=>{const range=virtualRange(10000,145000,580,29);expect(range.end-range.start).toBeLessThanOrEqual(36);expect(range.start).toBeLessThan(5000);expect(range.end).toBeGreaterThan(5000);});
 it('handles empty, resized, and stale scroll positions',()=>{expect(virtualRange(0,0,500,29)).toEqual({start:0,end:0});expect(virtualRange(5,10000,500,29)).toEqual({start:4,end:5});expect(virtualRange(5,0,500,29)).toEqual({start:0,end:5});});
});
