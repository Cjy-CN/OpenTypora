// @vitest-environment jsdom
import {describe,expect,it} from 'vitest';
import {renderMarkdown,assetUrl,flowToMermaid,sequenceToMermaid} from '../src/render/markdown';
import {DEFAULT_SETTINGS} from '../src/shared/settings';
describe('Markdown projection',()=>{
  it('renders headings, navigation, GFM tables and footnotes without mutating source',()=>{const source='# A\r\n\r\n[toc]\r\n\r\n| A | B |\r\n| - | - |\r\n| 1 | 2 |\r\n\r\nNote[^x]\r\n\r\n[^x]: Footnote';const html=renderMarkdown(source,DEFAULT_SETTINGS);expect(html).toContain('id="a"');expect(html).toContain('markdown-toc');expect(html).toContain('<table>');expect(html).toContain('Footnote');expect(source).toContain('\r\n');});
  it('filters scripts, event handlers and dangerous URLs',()=>{const html=renderMarkdown('<img src=x onerror="alert(1)"><script>alert(1)</script>\n<a href="javascript:alert(1)">x</a>',DEFAULT_SETTINGS);expect(html).not.toContain('<script');expect(html).not.toContain('onerror');expect(html).not.toContain('javascript:');});
  it('applies extension switches and math delimiters',()=>{const html=renderMarkdown('==mark== H~2~O x^2^ $x^2$\n\n$$\nx^2\n$$',{...DEFAULT_SETTINGS,'markdown.highlight':true,'markdown.sub':true,'markdown.sup':true,'markdown.inlineMath':true});expect(html).toContain('<mark>');expect(html).toContain('<sub>');expect(html).toContain('<sup>');expect(html).toContain('katex');});
  it('projects diagrams and alerts as safe view-only widgets',()=>{const html=renderMarkdown('> [!WARNING]\n> Alert\n\n```mermaid\nflowchart TD\nA-->B\n```',DEFAULT_SETTINGS);expect(html).toContain('markdown-alert-warning');expect(html).toContain('data-diagram="mermaid"');expect(html).toContain('data-source=');});
  it('resolves relative assets and converts classic diagram dialects',()=>{expect(assetUrl('../assets/a.png','E:\\docs\\notes\\a.md')).toBe('opentypora-asset://local/E%3A%2Fdocs%2Fassets%2Fa.png');expect(sequenceToMermaid('A->B: Hi')).toContain('A->>B: Hi');expect(flowToMermaid('a=>start: Start\nb=>end: End\na->b')).toContain('a --> b');});
});
