import { contextBridge, ipcRenderer } from 'electron';
import { BRIDGE_METHODS, IPC_CHANNEL } from '../src/shared/contracts';
import type { DesktopBridge } from '../src/shared/contracts';
const bridge = Object.fromEntries(BRIDGE_METHODS.map(method => [method, (...args: unknown[]) => ipcRenderer.invoke(IPC_CHANNEL, method, args)])) as unknown as Omit<DesktopBridge,'onCommand'|'onFileChanged'>;
const subscribe = (channel: string, callback: (value: string) => void) => { const listener = (_event: unknown, value: string) => callback(value); ipcRenderer.on(channel,listener); return () => { ipcRenderer.removeListener(channel,listener); }; };
contextBridge.exposeInMainWorld('opentypora', { ...bridge, onCommand: (callback: (id:string)=>void) => subscribe('opentypora:command',callback), onFileChanged: (callback:(path:string)=>void) => subscribe('opentypora:fileChanged',callback) } satisfies DesktopBridge);
