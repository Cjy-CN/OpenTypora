import { afterEach,describe,expect,it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, saveFile } from '../electron/services/files';
const directories:string[]=[];
afterEach(async()=>{for(const path of directories.splice(0))await fs.rm(path,{recursive:true,force:true});});
describe('disk persistence contract',()=>{
  it('round-trips UTF-8 BOM and mixed source whitespace',async()=>{
    const directory=await fs.mkdtemp(join(tmpdir(),'opentypora-test-'));directories.push(directory);const path=join(directory,'中文 文档.md');const text='# 标题\r\n\r\nA    B\n';
    const saved=await saveFile({path,text,version:4,encoding:'utf-8',bom:true,expectedFingerprint:null});const opened=await readFile(path);
    expect(opened.text).toBe(text);expect(opened.bom).toBe(true);expect(saved.version).toBe(4);expect(opened.fingerprint.hash).toBe(saved.fingerprint.hash);expect(await fs.readdir(directory)).toEqual(['中文 文档.md']);
  });
  it('refuses external modification and preserves the newer disk file',async()=>{
    const directory=await fs.mkdtemp(join(tmpdir(),'opentypora-test-'));directories.push(directory);const path=join(directory,'test.md');const saved=await saveFile({path,text:'first',version:1,encoding:'utf-8',bom:false,expectedFingerprint:null});await fs.writeFile(path,'external');
    await expect(saveFile({path,text:'local',version:2,encoding:'utf-8',bom:false,expectedFingerprint:saved.fingerprint})).rejects.toMatchObject({code:'EXTERNAL_CONFLICT'});expect(await fs.readFile(path,'utf-8')).toBe('external');
  });
});
