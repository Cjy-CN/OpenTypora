import {describe,it,expect} from 'vitest';
import {COMMANDS} from '../shared/command-catalog';
import {DEFAULT_EXPORT_PROFILES} from './export-profiles';
import {buildMenuEntries,menuPosition,MENU_NAMES,type MenuEntry} from './WorkspaceMenu';

describe('menu structure and viewport placement',()=>{
 it('preserves every command and all nine catalog submenus',()=>{
  const walk=(items:MenuEntry[]):MenuEntry[]=>items.flatMap(item=>[item,...walk(item.children??[])]);
  const all=MENU_NAMES.flatMap(root=>walk(buildMenuEntries(COMMANDS,root,DEFAULT_EXPORT_PROFILES)));
  expect(all.filter(item=>item.key.startsWith('export:')).map(item=>item.argument?.id)).toEqual(DEFAULT_EXPORT_PROFILES.map(profile=>profile.id));
  expect(new Set(all.filter(item=>item.children&&item.key!=='file.export').map(item=>item.key))).toEqual(new Set(COMMANDS.filter(command=>command.menu.includes('/')).map(command=>command.menu)));
  expect(new Set(all.flatMap(item=>item.command?[item.command.id]:[]))).toEqual(new Set(COMMANDS.map(command=>command.id)));
 });
 it('keeps third-level paths nested instead of flattening their labels',()=>{
  const command={id:'third',label:'Action',menu:'文件/Group/Subgroup',modifiesDocument:false};
  const entries=buildMenuEntries([command],'文件',[]);
  expect(entries[0].label).toBe('Group');expect(entries[0].children?.[0].label).toBe('Subgroup');
  expect(entries[0].children?.[0].children?.[0].command).toBe(command);
 });
 it('opens beside the parent without expanding its layout',()=>{
  expect(menuPosition({left:54,right:334,top:440,bottom:468},{width:280,height:550},{width:1280,height:900},true)).toEqual({left:333,top:342});
 });
 it('flips left and clamps tall menus inside a small viewport',()=>{
  expect(menuPosition({left:420,right:700,top:350,bottom:378},{width:280,height:800},{width:720,height:480},true)).toEqual({left:141,top:8});
  expect(menuPosition({left:650,right:700,top:60,bottom:82},{width:280,height:300},{width:720,height:480},false)).toEqual({left:432,top:85});
 });
});
