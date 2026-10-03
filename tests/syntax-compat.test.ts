import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';
import { prepareMarkdownSource } from '../src/render/syntax-compat';
import { DEFAULT_SETTINGS, type SettingsSnapshot } from '../src/shared/settings';

const markdown = new MarkdownIt({ html: true });
const lenient = { ...DEFAULT_SETTINGS, 'markdown.strict': false };
const unicode = { ...DEFAULT_SETTINGS, 'markdown.unicodePunctuation': true };
const render = (source: string, settings: SettingsSnapshot = DEFAULT_SETTINGS) => markdown.render(prepareMarkdownSource(source, settings));

describe('strict Markdown parser projection', () => {
  it('allows missing heading whitespace only with strict mode disabled and leaves canonical source intact', () => {
    const source = '###Header\r\n\r\n## 标准标题\r\n#######not a heading';
    expect(prepareMarkdownSource(source, DEFAULT_SETTINGS)).toBe(source);
    expect(render(source)).not.toContain('<h3>');
    expect(render(source, lenient)).toContain('<h3>Header</h3>');
    expect(prepareMarkdownSource(source, lenient)).toBe(source.replace('###Header', '### Header'));
    expect(source).toBe('###Header\r\n\r\n## 标准标题\r\n#######not a heading');
  });

  it('keeps two-space continuation paragraphs within an ordered list item only in lenient mode', () => {
    const source = '1. aaa\n\n  bbb';
    const strictHtml = render(source), tolerantHtml = render(source, lenient);
    expect(strictHtml).toMatch(/<\/ol>\s*<p>bbb<\/p>/);
    expect(tolerantHtml).toMatch(/<li>\s*<p>aaa<\/p>\s*<p>bbb<\/p>\s*<\/li>/);
    expect(prepareMarkdownSource(source, lenient)).toBe('1. aaa\n\n   bbb');
  });

  it('retains the documented two-space ordered sublist beneath a two-digit marker', () => {
    const source = '10. aaa\n  1. ccc';
    const html = render(source, lenient);
    expect(html).toMatch(/<ol start="10">\s*<li>aaa\s*<ol>\s*<li>ccc<\/li>\s*<\/ol>\s*<\/li>/);
    expect(render(source)).not.toMatch(/<li>aaa\s*<ol>/);
    expect(prepareMarkdownSource(source, lenient)).toBe('10. aaa\n    1. ccc');
  });

  it('carries alignment through nested siblings without overindenting already valid list structure', () => {
    const source = '10. parent\n  1. child\n  2. second\n11. next';
    const projected = prepareMarkdownSource(source, lenient), tokens = markdown.parse(projected, {});
    expect(projected).toBe('10. parent\n    1. child\n    2. second\n11. next');
    expect(tokens.filter(token => token.type === 'ordered_list_open')).toHaveLength(2);
    expect(tokens.find(token => token.type === 'code_block')).toBeUndefined();
    const valid = '1. aaa\n\n   bbb\n2. ccc'; expect(prepareMarkdownSource(valid, lenient)).toBe(valid);
  });

  it('ends list alignment at a heading and supports inline code in a list or heading', () => {
    const source = '10. `literal`\n\n  continuation\n\n###Header `literal`\n  outside';
    expect(prepareMarkdownSource(source, lenient)).toBe('10. `literal`\n\n    continuation\n\n### Header `literal`\n  outside');
  });

  it('does not absorb an unindented paragraph or a one-space nested-looking marker', () => {
    const source = '1. aaa\n\nplain\n\n  outside\n\n10. aaa\n 1. same-level';
    expect(prepareMarkdownSource(source, lenient)).toBe(source);
    expect(render(source, lenient)).toContain('</ol>\n<p>plain</p>');
  });

  it('does not infer a list from numbered prose that cannot interrupt a paragraph', () => {
    const source = 'intro\n10. prose\n\n  paragraph';
    expect(prepareMarkdownSource(source, lenient)).toBe(source);
    expect(render(source, lenient)).not.toContain('<pre>');
  });
});

describe('Unicode punctuation parser projection', () => {
  it('remaps only paired comment syntax, not ordinary em dashes', () => {
    const source = '<!— 中文 comment —>\n\nbody — prose\n<!— unterminated';
    expect(prepareMarkdownSource(source, DEFAULT_SETTINGS)).toBe(source);
    expect(prepareMarkdownSource(source, unicode)).toBe('<!-- 中文 comment -->\n\nbody — prose\n<!— unterminated');
    expect(render(source, unicode)).toContain('<!-- 中文 comment -->');
  });

  it('parses curly/guillemet image or link titles without remapping quoted prose', () => {
    const source = '![link](url «title»)\n![link](url “title”)\n[link](<path space> ‘title’)\n\n“ordinary prose” «prose»';
    const html = render(source, unicode);
    expect((html.match(/title="title"/g) ?? [])).toHaveLength(3);
    expect(prepareMarkdownSource(source, unicode)).toContain('“ordinary prose” «prose»');
    expect(render(source)).not.toContain('title="title"');
  });

  it('preserves ASCII quotes inside a remapped Unicode title and rejects mismatched quote pairs', () => {
    const source = '[x](url “a "quoted" title”)\n[x](url «mismatch”)';
    expect(prepareMarkdownSource(source, unicode)).toBe('[x](url "a \\"quoted\\" title")\n[x](url «mismatch”)');
    expect(render(source, unicode)).toContain('title="a &quot;quoted&quot; title"');
  });

  it('uses title positions rather than Unicode quotes in labels and respects escaped syntax', () => {
    const source = '![“label”](url “title”)\n\\[escaped](url “title”)\n\\<!— literal —>';
    expect(prepareMarkdownSource(source, unicode)).toBe('![“label”](url "title")\n\\[escaped](url “title”)\n\\<!— literal —>');
    expect(render(source, unicode)).toContain('alt="“label”" title="title"');
  });

  it('maps isolated em dashes to a horizontal rule and Chinese quote markers to blockquotes', () => {
    const source = ' — \n\n》 引用\n》 》 嵌套\n\nbody — prose';
    const html = render(source, unicode);
    expect(html).toContain('<hr>'); expect((html.match(/<blockquote>/g) ?? [])).toHaveLength(2);
    expect(html).toContain('body — prose'); expect(render(source)).not.toContain('<hr>');
  });

  it('combines a Unicode quote container with a lenient heading without changing prose punctuation', () => {
    const source = '》 ###Header\n\n###正文 “quoted”';
    expect(render(source, { ...lenient, 'markdown.unicodePunctuation': true })).toContain('<blockquote>\n<h3>Header</h3>');
    expect(prepareMarkdownSource(source, { ...lenient, 'markdown.unicodePunctuation': true })).toBe('> ### Header\n\n### 正文 “quoted”');
  });
});

describe('literal source protection', () => {
  const both = { ...lenient, 'markdown.unicodePunctuation': true };
  const literal = '###Header\n<!— comment —>\n![x](url “title”)\n — \n》 quote';
  it('preserves fenced and indented code, including code fences inside list items', () => {
    for (const source of ['```md\n' + literal + '\n```', '~~~md\n' + literal + '\n~~~', literal.split('\n').map(line => '    ' + line).join('\n'), '1. item\n\n   ```md\n' + literal.split('\n').map(line => '   ' + line).join('\n') + '\n   ```']) {
      expect(prepareMarkdownSource(source, both)).toBe(source);
    }
  });
  it('preserves inline code while still adapting adjacent Markdown syntax', () => {
    const source = '###Header\n\n`<!— comment —> ![x](url “title”)` and ![x](url “title”)';
    expect(prepareMarkdownSource(source, both)).toBe('### Header\n\n`<!— comment —> ![x](url “title”)` and ![x](url "title")');
  });
  it('preserves YAML, block math and inline math regardless of rendering switches', () => {
    for (const source of ['---\nvalue: "<!— comment —>"\n---', '$$\n' + literal + '\n$$', '\\[\n' + literal + '\n\\]', 'before $<!— comment —> ![x](url “title”)$ after', 'before \\(<!— comment —>\\) after']) expect(prepareMarkdownSource(source, both)).toBe(source);
  });
  it('retains CRLF and standalone CR line endings in the projection', () => {
    const source = '###Header\r\n\r\n10. aaa\r\n  1. ccc\r\n';
    expect(prepareMarkdownSource(source, both)).toBe('### Header\r\n\r\n10. aaa\r\n    1. ccc\r\n');
    expect(prepareMarkdownSource('###Header\r\r — \r', both)).toBe('### Header\r\r --- \r');
  });
});
