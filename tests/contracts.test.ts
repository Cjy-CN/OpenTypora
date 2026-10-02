import { describe,expect,it } from 'vitest';
import { CommandRegistry } from '../src/core/commands';
import { DocumentStore } from '../src/core/document';
import { COMMANDS } from '../src/shared/command-catalog';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA, SettingsStore } from '../src/shared/settings';
describe('shared registration contracts',()=>{
  it('has unique command and configuration IDs',()=>{expect(new Set(COMMANDS.map(item=>item.id)).size).toBe(COMMANDS.length);expect(new Set(SETTINGS_SCHEMA.map(item=>item.key)).size).toBe(Object.keys(DEFAULT_SETTINGS).length);});
  it('does not report unimplemented commands as available',async()=>{
    const registry=new CommandRegistry(COMMANDS),context={document:new DocumentStore(),notify:()=>{}};
    expect(registry.isEnabled('file.export',context)).toBe(false);expect((await registry.execute('file.export',context)).ok).toBe(false);
    registry.register('edit.undo',()=>{},()=>true);expect(registry.isEnabled('edit.undo',context)).toBe(true);context.document.patchMetadata({readonly:true});expect(registry.isEnabled('edit.undo',context)).toBe(false);
    expect(()=>registry.register('missing',()=>{})).toThrow('UNKNOWN_COMMAND');
  });
  it('rejects malformed configuration while preserving valid defaults',()=>{
    const settings=new SettingsStore();expect(settings.set('appearance.zoom',0).ok).toBe(false);expect(settings.set('editor.indent','4').ok).toBe(false);expect(settings.set('image.uploader','fake').ok).toBe(false);expect(settings.set('general.shortcuts','[]').ok).toBe(false);
    expect(settings.getSnapshot()['appearance.zoom']).toBe(100);expect(settings.set('appearance.zoom',125).ok).toBe(true);expect(settings.load({'unknown.key':true,'file.autoSave':true})).toEqual(['unknown.key']);expect(settings.getSnapshot()['file.autoSave']).toBe(true);
  });
});
