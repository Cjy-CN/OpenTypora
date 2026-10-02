// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect,it,vi} from 'vitest';
vi.mock('../src/platform/desktop',()=>({desktop:undefined}));
import {App} from '../src/App';
import {CommandRegistry} from '../src/core/commands';
import {COMMANDS} from '../src/shared/command-catalog';
const registration=vi.spyOn(CommandRegistry.prototype,'register');
it('mounts the integrated editor and binds every catalog command once',async()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});window.matchMedia=vi.fn(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;globalThis.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};const container=document.createElement('div');document.body.append(container);const root=createRoot(container);await act(async()=>{root.render(<App/>);await new Promise(resolve=>setTimeout(resolve,0));});expect(container.querySelector('.cm-editor')).toBeTruthy();expect(container.textContent).toContain('文件');expect(container.textContent).toContain('主题');const ids=registration.mock.calls.map(call=>call[0]);expect(COMMANDS.filter(command=>!ids.includes(command.id)).map(command=>command.id)).toEqual([]);expect(new Set(ids).size).toBe(ids.length);await act(async()=>root.unmount());container.remove();});
