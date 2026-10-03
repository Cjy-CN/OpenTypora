import {afterEach,expect,it} from 'vitest';
import {promises as fs} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../electron/services/storage';
import {createDocument} from '../src/core/document';
let directory:string;
afterEach(async()=>{if(directory)await fs.rm(directory,{recursive:true,force:true});});
it('waits for an already queued draft write before deleting it',async()=>{directory=await fs.mkdtemp(join(tmpdir(),'opentypora-recovery-order-'));const storage=new Storage(directory),session=createDocument('测试🙂'.repeat(20000)),writing=storage.writeRecovery({id:session.recoveryId,session,savedAt:Date.now()}),deleting=storage.deleteRecovery(session.recoveryId);await Promise.all([writing,deleting]);expect(await storage.listRecovery()).toEqual([]);});
