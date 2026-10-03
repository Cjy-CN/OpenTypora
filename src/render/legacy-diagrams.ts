export type LegacyDiagramKind = 'sequence' | 'flow';

const escape = (value: string) => value.replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
const textLines = (value: string, max = 32) => {
  const words = value.replace(/\\n/g, '\n').split(/\r?\n/);
  const output: string[] = [];
  for (const word of words) {
    if (word.length <= max) output.push(word);
    else for (let index = 0; index < word.length; index += max) output.push(word.slice(index, index + max));
  }
  return output.length ? output : [''];
};
const svgText = (x: number, y: number, value: string, anchor = 'middle', size = 13, weight = '400') =>
  textLines(value).map((line, index) => `<text x="${x}" y="${y + index * (size + 2)}" text-anchor="${anchor}" font-family="Consolas,monospace" font-size="${size}px" font-weight="${weight}" fill="#333">${escape(line)}</text>`).join('');

interface SequenceActor { id: string; label: string; }
interface SequenceMessage { from: string; to: string; text: string; dashed: boolean; }
interface SequenceNote { placement: 'left' | 'right' | 'over'; actors: string[]; text: string; }
interface SequenceMarker { kind: 'loop' | 'alt' | 'else' | 'end'; text: string; }
function parseSequence(source: string) {
  const actors: SequenceActor[] = [], byId = new Map<string, SequenceActor>(), messages: SequenceMessage[] = [], notes: SequenceNote[] = [], markers: SequenceMarker[] = [];
  let title = '';
  const addActor = (id: string, label = id) => { const clean = id.trim(); if (!clean) return; const existing = byId.get(clean); if (existing) { if (label.trim() && existing.label === existing.id) existing.label = label.trim(); return; } const actor = {id: clean, label: label.trim() || clean}; byId.set(clean, actor); actors.push(actor); };
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const titleMatch = /^(?:title|Title):\s*(.*)$/.exec(line); if (titleMatch) { title = titleMatch[1]; continue; }
    const participant = /^(?:participant|actor)\s+(.+?)\s+as\s+(\S+)$/i.exec(line); if (participant) { addActor(participant[2], participant[1]); continue; }
    const simpleParticipant = /^(?:participant|actor)\s+(.+)$/i.exec(line); if (simpleParticipant) { addActor(simpleParticipant[1]); continue; }
    const note = /^note\s+(left|right|over)\s+of\s+([^:]+):\s*(.*)$/i.exec(line); if (note) { const ids = note[2].split(/\s*,\s*/); ids.forEach(id => addActor(id)); notes.push({placement: note[1].toLowerCase() as SequenceNote['placement'], actors: ids, text: note[3]}); continue; }
    const marker = /^(loop|alt|else|end)\b\s*(.*)$/i.exec(line); if (marker) { markers.push({kind: marker[1].toLowerCase() as SequenceMarker['kind'], text: marker[2]}); continue; }
    const message = /^(.+?)\s*(-->>|->>|-->|->|<<-|<--|<-|<->)\s*(.+?)(?:\s*:\s*(.*))?$/.exec(line); if (!message) continue;
    let from = message[1].trim(), to = message[3].trim(), arrow = message[2]; if (/^(?:<-|<--|<<-)$/.test(arrow)) [from, to] = [to, from]; addActor(from); addActor(to); messages.push({from, to, text: message[4] ?? '', dashed: arrow.includes('--')});
  }
  return {actors, byId, messages, notes, markers, title};
}
function titleY(title: string) { return title ? 32 : 20; }
export function renderSequenceDiagram(source: string): string {
  const model = parseSequence(source); if (!model.actors.length) throw new Error('序列图没有可识别的参与者或消息');
  const gap = Math.max(105, Math.min(180, 500 / Math.max(1, model.actors.length - 1))), left = 58, baseWidth = Math.max(220, Math.round(left * 2 + gap * Math.max(0, model.actors.length - 1))), positions = new Map(model.actors.map((actor, index) => [actor.id, left + index * gap]));
  const noteExtent = model.notes.reduce((extent, note) => { const lines = textLines(note.text), noteWidth = Math.max(68, Math.min(190, Math.max(...lines.map(line => line.length)) * 7 + 18)), xs = note.actors.map(actor => positions.get(actor) ?? left); if (note.placement === 'right') return Math.max(extent, Math.max(...xs) + noteWidth + 54); if (note.placement === 'left') return Math.max(extent, baseWidth + noteWidth / 2); return extent; }, baseWidth);
  const width = Math.ceil(noteExtent), height = Math.max(145, 54 + (model.messages.length + model.notes.length + model.markers.length) * 29), actorY = titleY(model.title), bodyStart = actorY + 35, bodyEnd = height - 12;
  let body = model.actors.map(actor => { const x = positions.get(actor.id)!; return `<line x1="${x}" y1="${bodyStart}" x2="${x}" y2="${bodyEnd}" stroke="#555" stroke-width="1" stroke-dasharray="4 4"/>`; }).join(''); let row = 0; const yFor = () => bodyStart + 18 + row++ * 29;
  for (const marker of model.markers) { const y = yFor(); body += `<line x1="14" y1="${y - 11}" x2="${width - 14}" y2="${y - 11}" stroke="#999" stroke-width="1"/>${svgText(18, y + 3, `${marker.kind}${marker.text ? ` ${marker.text}` : ''}`, 'start', 11)}`; }
  for (const message of model.messages) { const x1 = positions.get(message.from)!, x2 = positions.get(message.to)!, y = yFor(); if (x1 === x2) body += `<path d="M ${x1} ${y - 7} C ${x1 + 42} ${y - 7}, ${x1 + 42} ${y + 13}, ${x1} ${y + 13}" fill="none" stroke="#333" stroke-width="1.4" marker-end="url(#sequence-arrow)"/>${svgText(x1 + 40, y - 10, message.text, 'middle', 12)}`; else body += `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#333" stroke-width="1.4" ${message.dashed ? 'stroke-dasharray="4 3"' : ''} marker-end="url(#sequence-arrow)"/>${svgText((x1 + x2) / 2, y - 5, message.text, 'middle', 12)}`; }
  for (const note of model.notes) { const xs = note.actors.map(actor => positions.get(actor) ?? left), y = yFor(), lines = textLines(note.text), noteWidth = Math.max(68, Math.min(190, Math.max(...lines.map(line => line.length)) * 7 + 18)); const center = note.placement === 'left' ? Math.min(...xs) - noteWidth / 2 - 34 : note.placement === 'right' ? Math.max(...xs) + noteWidth / 2 + 34 : (Math.min(...xs) + Math.max(...xs)) / 2; body += `<rect x="${center - noteWidth / 2}" y="${y - 15}" width="${noteWidth}" height="${Math.max(24, lines.length * 15 + 8)}" fill="#fff" stroke="#555" stroke-width="1"/>${svgText(center, y + 1, note.text, 'middle', 11)}`; }
  const title = model.title ? svgText(width / 2, 14, model.title, 'middle', 13, '600') : '';
  const actors = model.actors.map(actor => { const x = positions.get(actor.id)!; return `<rect x="${x - 33}" y="${actorY - 15}" width="66" height="28" fill="#fff" stroke="#333" stroke-width="1.4"/>${svgText(x, actorY + 3, actor.label, 'middle', 12)}`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="序列图" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><marker id="sequence-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#333"/></marker></defs>${title}${actors}${body}</svg>`;
}

interface FlowNode { id: string; type: string; label: string; }
interface FlowEdge { from: string; to: string; label: string; }
function parseFlow(source: string) {
  const nodes = new Map<string, FlowNode>(), edges: FlowEdge[] = [];
  for (const raw of source.split(/\r?\n/)) { const line = raw.trim(); if (!line) continue; const definition = /^([\w-]+)\s*=>\s*([\w-]+)\s*:\s*(.*)$/.exec(line); if (definition) { const label = definition[3].split('|')[0].replace(/:>.*$/, '').trim(); nodes.set(definition[1], {id: definition[1], type: definition[2].toLowerCase(), label}); continue; } if (!line.includes('->')) continue; const parts = line.split(/->/).map(part => { const match = /^\s*([\w-]+)(?:\(([^)]*)\))?/.exec(part); return match ? {id: match[1], label: match[2] ?? ''} : null; }).filter((part): part is {id:string;label:string} => !!part); for (let index = 0; index + 1 < parts.length; index++) edges.push({from: parts[index].id, to: parts[index + 1].id, label: parts[index].label}); }
  return {nodes: [...nodes.values()], edges};
}
function nodeBox(node: FlowNode, x: number, y: number, width: number, height: number) { const text = svgText(x + width / 2, y + height / 2 + 4, node.label, 'middle', 13); if (node.type === 'start' || node.type === 'end') return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="#fff" stroke="#333" stroke-width="2"/>${text}`; if (node.type === 'condition') return `<path d="M ${x + width / 2} ${y} L ${x + width} ${y + height / 2} L ${x + width / 2} ${y + height} L ${x} ${y + height / 2} Z" fill="#fff" stroke="#333" stroke-width="2"/>${text}`; if (node.type === 'inputoutput') return `<path d="M ${x + 12} ${y} L ${x + width} ${y} L ${x + width - 12} ${y + height} L ${x} ${y + height} Z" fill="#fff" stroke="#333" stroke-width="2"/>${text}`; return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff" stroke="#333" stroke-width="2"/>${text}`; }
export function renderFlowDiagram(source: string): string {
  const model = parseFlow(source); if (!model.nodes.length) throw new Error('流程图没有可识别的节点'); const incoming = new Map(model.nodes.map(node => [node.id, 0])); model.edges.forEach(edge => incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)); const rank = new Map<string, number>(), queue = model.nodes.filter(node => !(incoming.get(node.id) ?? 0)).map(node => node.id); queue.forEach(id => rank.set(id, 0)); while (queue.length) { const id = queue.shift()!; for (const edge of model.edges.filter(item => item.from === id)) { const next = Math.max(rank.get(edge.to) ?? 0, (rank.get(id) ?? 0) + 1); if (next !== rank.get(edge.to)) { rank.set(edge.to, next); queue.push(edge.to); } } } model.nodes.forEach(node => { if (!rank.has(node.id)) rank.set(node.id, 0); }); const groups = new Map<number, FlowNode[]>(); model.nodes.forEach(node => { const group = groups.get(rank.get(node.id)!) ?? []; group.push(node); groups.set(rank.get(node.id)!, group); }); const nodeWidth = 112, nodeHeight = 32, verticalGap = 66, maxGroup = Math.max(...[...groups.values()].map(group => group.length)), width = Math.max(230, maxGroup * 150 + 40), height = Math.max(130, groups.size * verticalGap + 64), positions = new Map<string, {x:number;y:number}>(); for (const [level, group] of groups) { const gap = width / (group.length + 1); group.forEach((node, index) => positions.set(node.id, {x: gap * (index + 1) - nodeWidth / 2, y: 22 + level * verticalGap})); } const lines = model.edges.map(edge => { const from = positions.get(edge.from)!, to = positions.get(edge.to)!; const x1 = from.x + nodeWidth / 2, y1 = from.y + nodeHeight, x2 = to.x + nodeWidth / 2, y2 = to.y; return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="2" marker-end="url(#flow-arrow)"/>${edge.label ? svgText((x1 + x2) / 2 + 6, (y1 + y2) / 2, edge.label, 'start', 11) : ''}`; }).join(''); const boxes = model.nodes.map(node => { const position = positions.get(node.id)!; return nodeBox(node, position.x, position.y, nodeWidth, nodeHeight); }).join(''); return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="流程图" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0,0 L7,3 L0,0 z" fill="#333"/></marker></defs>${lines}${boxes}</svg>`;
}
export function renderLegacyDiagram(kind: LegacyDiagramKind, source: string) { return kind === 'sequence' ? renderSequenceDiagram(source) : renderFlowDiagram(source); }
