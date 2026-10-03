import {describe,expect,it} from 'vitest';
import {launchDocument} from '../src/shared/launch-document';
describe('Explorer document arguments',()=>{
 it('accepts a Markdown path with spaces and Chinese characters as one argument',()=>{
  const path='C:\\Notes Folder\\中文笔记.MD';
  expect(launchDocument(['C:\\Programs\\OpenTypora.exe',path],true)).toBe(path);
 });
 it('preserves explicit file arguments and ignores the development application directory',()=>{
  expect(launchDocument(['electron','C:\\projects\\folder.md','--visual-test','C:\\notes\\a.md'],false)).toBe('C:\\notes\\a.md');
  expect(launchDocument(['OpenTypora.exe','--document','C:\\notes\\explicit.md','other.md'],true)).toBe('C:\\notes\\explicit.md');
  expect(launchDocument(['OpenTypora.exe','--visual-test'],true)).toBeUndefined();
 });
});
