import {expect,it} from 'vitest';
import {matchesShortcut} from '../src/shared/command-catalog';
it('recognizes shifted punctuation and recorded plus shortcuts',()=>{const event=(key:string,code:string,shiftKey=true)=>({key,code,shiftKey,ctrlKey:true,altKey:false,metaKey:false}) as KeyboardEvent;expect(matchesShortcut(event('+','Equal'),'Ctrl+Shift+=')).toBe(true);expect(matchesShortcut(event('{','BracketLeft'),'Ctrl+Shift+[')).toBe(true);expect(matchesShortcut(event('+','Equal'),'Ctrl+Shift++')).toBe(true);expect(matchesShortcut(event('+','Equal'),'Ctrl+=')).toBe(false);});
