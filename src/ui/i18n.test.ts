import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {localizeUi,translateUi} from './i18n';
describe('UI language boundaries',()=>{
 it('translates labels while leaving entered values, user content and code literal',()=>{
  const tree=createElement('section',null,createElement('button',{title:'偏好设置'},'文件'),createElement('input',{defaultValue:'文件',placeholder:'搜索设置…'}),createElement('textarea',{defaultValue:'主题'}),createElement('p',{'data-user-content':true},'文件'),createElement('pre',null,'主题'));
  const html=renderToStaticMarkup(localizeUi(tree,'en'));
  expect(html).toContain('title="Preferences"');expect(html).toContain('>File</button>');expect(html).toContain('value="文件"');expect(html).toContain('placeholder="Search settings…"');expect(html).toContain('>主题</textarea>');expect(html).toContain('>文件</p>');expect(html).toContain('<pre>主题</pre>');
 });
 it('keeps the Chinese tree and translates numbered UI messages',()=>{const node=createElement('button',null,'文件');expect(localizeUi(node,'zh-CN')).toBe(node);expect(translateUi('2 个标题','en')).toBe('2 headings');expect(translateUi('选中 2 词 · ','en')).toBe('Selected 2 words · ');});
});
