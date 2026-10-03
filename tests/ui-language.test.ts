import {describe,expect,it} from 'vitest';
import {resolveUiLanguage} from '../src/shared/ui-language';
import {DEFAULT_SETTINGS,SettingsStore} from '../src/shared/settings';

describe('interface language preferences',()=>{
 it.each(['zh','zh-CN','zh-TW','zh-Hant-HK','ZH_hans_CN'])('uses Simplified Chinese for %s',language=>{
  expect(resolveUiLanguage('auto',[language,'en-US'])).toBe('zh-CN');
 });
 it('uses the first system preference and falls back to English for unsupported or missing languages',()=>{
  expect(resolveUiLanguage('auto',['en-GB','zh-CN'])).toBe('en');
  expect(resolveUiLanguage('auto',['fr-FR','zh-CN'])).toBe('en');
  expect(resolveUiLanguage('auto',[])).toBe('en');
 });
 it('preserves explicit choices when loading existing configuration',()=>{
  expect(DEFAULT_SETTINGS['general.language']).toBe('auto');
  const settings=new SettingsStore();settings.load({'general.language':'zh-CN'});
  expect(resolveUiLanguage(settings.getSnapshot()['general.language'],['en-US'])).toBe('zh-CN');
  settings.load({'general.language':'en'});
  expect(resolveUiLanguage(settings.getSnapshot()['general.language'],['zh-CN'])).toBe('en');
  expect(settings.set('general.language','auto').ok).toBe(true);
  expect(settings.set('general.language','fr').ok).toBe(false);
 });
});
