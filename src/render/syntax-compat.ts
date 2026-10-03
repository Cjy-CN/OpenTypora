import MarkdownIt from 'markdown-it';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { markdownBlocks, sourceLines } from '../core/formatting';
import type { SettingsSnapshot } from '../shared/settings';
import type { TextChange } from '../shared/contracts';

type SyntaxSettings = Pick<SettingsSnapshot, 'markdown.strict' | 'markdown.unicodePunctuation'>;
interface Range { from: number; to: number }
const parser = new MarkdownIt({ html: true });

/** Protect actual literal blocks, then retain exact source ranges for inline literals. */
function sourceContext(text: string): { ranges: Range[]; listStarts: Set<number> } {
  const lines = sourceLines(text), ranges: Range[] = [], listStarts = new Set<number>();
  for (const token of parser.parse(text, {})) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      ranges.push({ from: lines[token.map[0]]?.from ?? text.length, to: lines[token.map[1]]?.from ?? text.length });
    }
    if (token.type === 'list_item_open' && token.map) listStarts.add(lines[token.map[0]]?.from ?? text.length);
  }
  markdownLanguage.parser.parse(text).iterate({ enter(node) {
    if (node.name === 'InlineCode') { ranges.push({ from: node.from, to: node.to }); return false; }
  } });
  for (const block of markdownBlocks(text)) if (block.kind === 'yaml' || block.kind === 'math') ranges.push({ from: block.from, to: block.to });
  // Math delimiters are protected even when their rendering option is currently disabled.
  for (const match of text.matchAll(/(?<!\\)\\\([\s\S]*?(?<!\\)\\\)|(?<!\\)\\\[[\s\S]*?(?<!\\)\\\]/g)) ranges.push({ from: match.index!, to: match.index! + match[0].length });
  for (const line of lines) {
    for (const match of line.text.matchAll(/(?<![\\$])(\${1,2})(?!\$)([^\r\n]*?)(?<!\\)\1(?!\$)/g)) ranges.push({ from: line.from + match.index!, to: line.from + match.index! + match[0].length });
  }
  const merged: Range[] = [];
  for (const range of ranges.sort((a, b) => a.from - b.from || a.to - b.to)) {
    const previous = merged.at(-1);
    if (previous && previous.to >= range.from) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return { ranges: merged, listStarts };
}
function applyChanges(text: string, changes: TextChange[]) {
  for (const change of [...changes].sort((a, b) => b.from - a.from)) text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  return text;
}

interface ListLevel { sourceIndent: number; projectedIndent: number; contentIndent: number }
function escapedAt(text: string, position: number) {
  let slashes = 0;
  while (position > 0 && text[--position] === '\\') slashes++;
  return slashes % 2 === 1;
}

/**
 * Normalize parser input only; the canonical Markdown and its UTF-16 positions stay untouched.
 * Behaviors follow Typora's documented Strict Mode and Unicode-punctuation parse switches.
 */
export function prepareMarkdownSource(text: string, settings: SyntaxSettings): string {
  if (settings['markdown.strict'] && !settings['markdown.unicodePunctuation']) return text;
  const { ranges: protectedRanges, listStarts } = sourceContext(text), changes: TextChange[] = [];
  const precedingRange = (position: number, inclusive: boolean) => {
    let low = 0, high = protectedRanges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (protectedRanges[middle].from < position || inclusive && protectedRanges[middle].from === position) low = middle + 1;
      else high = middle;
    }
    return protectedRanges[low - 1];
  };
  const protectedAt = (from: number, to: number) => {
    const range = precedingRange(to, from === to);
    return !!range && range.to > from;
  };
  const add = (from: number, to: number, insert: string) => {
    if (!protectedAt(from, to) && text.slice(from, to) !== insert && !changes.some(change => from < change.to && to > change.from)) changes.push({ from, to, insert });
  };

  // Comment delimiters are paired. Prose em dashes do not become comment markers.
  if (settings['markdown.unicodePunctuation']) {
    for (const match of text.matchAll(/<!—[\s\S]*?—>/g)) {
      if (escapedAt(text, match.index!) || protectedAt(match.index!, match.index! + 3) || protectedAt(match.index! + match[0].length - 2, match.index! + match[0].length)) continue;
      add(match.index! + 2, match.index! + 3, '--');
      add(match.index! + match[0].length - 2, match.index! + match[0].length - 1, '--');
    }
    // Only a link/image destination's trailing title quote pair is remapped.
    for (const match of text.matchAll(/!?\[(?:\\.|[^\]\\\r\n])*\]\((?:<[^<>\r\n]*>|[^\s\r\n]+)[ \t]+([«“‘])([^\r\n]*?)([»”’])[ \t]*\)/g)) {
      if (escapedAt(text, match.index!) || { '«': '»', '“': '”', '‘': '’' }[match[1]] !== match[3]) continue;
      const trailing = match[0].match(/[ \t]*\)$/)![0].length;
      const end = match.index! + match[0].length - trailing - 1;
      const start = end - match[2].length - 1;
      // The whole title becomes one edit so inner ASCII quotes remain valid Markdown.
      const title = match[2].replace(/(\\*)"/g, (_quote, slashes: string) => slashes + (slashes.length % 2 ? '' : '\\') + '"');
      add(start, end + 1, `"${title}"`);
    }
  }

  let stack: ListLevel[] = [], blank = false;
  for (const line of sourceLines(text)) {
    const covering = precedingRange(line.from, true);
    if (covering && covering.to >= line.to) {
      const indent = line.text.match(/^ */)![0].length;
      if (!stack.length || indent < stack.at(-1)!.sourceIndent + 2) stack = [];
      blank = false; continue;
    }
    if (!line.text.trim()) { blank = true; continue; }
    const quote = /^( {0,3})((?:[>》][ \t]*)*)/.exec(line.text)!;
    const prefix = quote[0], body = line.text.slice(prefix.length), offset = line.from + prefix.length;
    if (settings['markdown.unicodePunctuation']) {
      for (let i = 0; i < prefix.length; i++) if (prefix[i] === '》') add(line.from + i, line.from + i + 1, '>');
      const hr = /^( {0,3})—[ \t]*$/.exec(body);
      if (hr) add(offset + hr[1].length, offset + hr[1].length + 1, '---');
    }
    if (settings['markdown.strict']) continue;
    const heading = /^( {0,3})(#{1,6})(?=[^#\s])/.exec(body);
    if (heading) add(offset + heading[0].length, offset + heading[0].length, ' ');

    // Quote containers keep their own Markdown indentation; do not mix their lists into root lists.
    if (/[>》]/.test(prefix)) { stack = []; blank = false; continue; }
    if (heading || /^ {0,3}#{1,6}(?:\s|$)/.test(line.text) || /^ {0,3}(?:(?:[-*_][ \t]*){3,}|<)/.test(line.text)) { stack = []; blank = false; continue; }
    const marker = /^( *)([-+*]|\d{1,9}[.)])([ \t]+)(?=\S|$)/.exec(line.text);
    const indent = line.text.match(/^ */)![0].length;
    if (marker) {
      while (stack.length && indent <= stack.at(-1)!.sourceIndent) stack.pop();
      let parent = stack.at(-1);
      // Nesting requires at least two source spaces; one-space markers keep strict behavior.
      if (parent && indent < parent.sourceIndent + 2) { stack = []; parent = undefined; }
      if (!parent && !listStarts.has(line.from)) { blank = false; continue; }
      const projectedIndent = parent ? Math.max(indent + parent.projectedIndent - parent.sourceIndent, parent.contentIndent) : indent;
      if (projectedIndent !== indent) add(line.from, line.from + indent, ' '.repeat(projectedIndent));
      const contentWidth = marker[2].length + (marker[3].length > 4 ? 1 : marker[3].length);
      stack.push({ sourceIndent: indent, projectedIndent, contentIndent: projectedIndent + contentWidth });
    } else {
      while (stack.length && indent < stack.at(-1)!.sourceIndent + 2) {
        if (!blank && indent <= stack[0].sourceIndent) break; // CommonMark lazy paragraph continuation.
        stack.pop();
      }
      const parent = stack.at(-1);
      if (parent && indent >= parent.sourceIndent + 2) {
        const projectedIndent = Math.max(indent + parent.projectedIndent - parent.sourceIndent, parent.contentIndent);
        if (projectedIndent !== indent) add(line.from, line.from + indent, ' '.repeat(projectedIndent));
      }
    }
    blank = false;
  }
  return applyChanges(text, changes);
}
