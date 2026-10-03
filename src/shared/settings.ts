import type { Result } from './contracts';
import { failure, success } from './errors';
export const DEFAULT_SETTINGS = {
  'file.startup': 'new', 'file.outlineFold': false, 'file.extension': '.md', 'file.autoSave': false, 'file.saveOnSwitch': false, 'file.recovery': true, 'file.history': true, 'file.dropFolder': 'open', 'file.dropMarkdown': 'open', 'file.dropImport': 'import',
  'editor.indent': 2, 'editor.alignIndent': false, 'editor.matchBrackets': true, 'editor.matchMarkdown': false, 'editor.emoji': true, 'editor.showActiveSource': false, 'editor.copyMarkdown': true, 'editor.copyWholeLine': false, 'editor.lineEnding': 'CRLF', 'editor.finalNewline': true, 'editor.spellLanguage': 'auto', 'editor.typewriterCenter': true,
  'image.strategy': 'none', 'image.folder': '${filename}.assets', 'image.applyLocal': true, 'image.applyRemote': false, 'image.yamlUpload': false, 'image.relative': false, 'image.prefixDot': false, 'image.escapeUrl': false, 'image.uploader': 'none', 'image.uploadExecutable': '', 'image.uploadArgs': '[]', 'image.uploadEndpoint': 'http://127.0.0.1:36677/upload',
  'markdown.strict': true, 'markdown.headingStyle': 'atx', 'markdown.unorderedMarker': '-', 'markdown.orderedMarker': 'increment', 'markdown.autoLink': true, 'markdown.inlineMath': false, 'markdown.sub': false, 'markdown.sup': false, 'markdown.highlight': false, 'markdown.alerts': true, 'markdown.diagrams': true, 'markdown.smartMode': 'input', 'markdown.smartQuotes': false, 'markdown.smartDashes': false, 'markdown.unicodePunctuation': false,
  'code.lineNumbers': false, 'code.wrap': true, 'code.shiftTab': false, 'code.indent': 4, 'code.defaultLanguage': '', 'math.latexDelimiters': true, 'math.fenced': true, 'math.newline': true, 'math.physics': false, 'math.numbering': false, 'math.htmlRepresentation': 'svg',
  'text.firstIndent': false, 'text.showBr': true, 'text.preserveSpaces': true, 'text.preserveBreaks': true, 'export.preserveSpaces': true, 'export.preserveBreaks': true, 'export.directory': '', 'export.pandocPath': '', 'export.openFolder': false, 'export.profiles': '[]', 'export.selectedProfile': 'builtin-html',
  'appearance.windowStyle': 'classic', 'appearance.fontSize': 16, 'appearance.autoFont': true, 'appearance.zoom': 100, 'appearance.ctrlWheel': false, 'appearance.statusBar': true, 'appearance.readingSpeed': 382, 'appearance.theme': 'github', 'appearance.darkTheme': 'night', 'appearance.independentDark': false, 'appearance.customCss': '',
  'general.language': 'auto', 'general.autoUpdate': false, 'general.developmentUpdates': false, 'general.debug': false, 'general.telemetry': false, 'general.telemetryEndpoint': '', 'general.serviceSource': 'https://api.github.com/repos/Cjy-CN/OpenTypora/releases/latest', 'general.shortcuts': '{}'
} as const;
export type SettingsKey = keyof typeof DEFAULT_SETTINGS;
export type SettingsSnapshot = { [K in SettingsKey]: typeof DEFAULT_SETTINGS[K] extends boolean ? boolean : typeof DEFAULT_SETTINGS[K] extends number ? number : string };
export interface SettingDefinition { key: SettingsKey; category: string; label: string; type: 'boolean' | 'number' | 'string'; scope: 'global' | 'document' | 'export'; effect: 'immediate' | 'restart'; choices?: string[]; min?: number; max?: number }
const CATEGORIES: Record<string,string> = { file:'文件',editor:'编辑器',image:'图像',markdown:'Markdown',code:'Markdown',math:'Markdown',text:'Markdown',export:'导出',appearance:'外观',general:'通用' };
const LABELS: Partial<Record<SettingsKey,string>> = {
  'file.startup':'启动时', 'file.outlineFold':'大纲允许折叠','file.extension':'默认后缀','file.autoSave':'自动保存原文件','file.saveOnSwitch':'切换时保存','file.recovery':'恢复草稿','file.history':'记录历史',
  'editor.indent':'默认缩进','editor.matchBrackets':'匹配括号与引号','editor.matchMarkdown':'匹配 Markdown 标记','editor.emoji':'Emoji 补全','editor.showActiveSource':'当前块源码','editor.copyWholeLine':'无选区复制整行','editor.lineEnding':'新文件换行','editor.spellLanguage':'拼写语言',
  'image.strategy':'插入图片策略','image.folder':'图片复制目录','image.uploader':'上传服务','image.relative':'相对路径','image.uploadExecutable':'上传工具路径','image.uploadArgs':'上传参数 JSON','image.uploadEndpoint':'上传服务地址',
  'markdown.inlineMath':'行内公式','markdown.diagrams':'序列图、流程图、Mermaid','markdown.strict':'严格语法','markdown.alerts':'警告框','markdown.highlight':'高亮','markdown.sub':'下标','markdown.sup':'上标',
  'code.lineNumbers':'代码行号','code.wrap':'代码自动换行','code.indent':'代码缩进','math.physics':'Physics 扩展','math.numbering':'公式编号','math.fenced':'数学代码围栏',
  'appearance.fontSize':'字体大小','appearance.zoom':'缩放','appearance.theme':'主题','appearance.windowStyle':'窗口样式','appearance.statusBar':'状态栏','appearance.readingSpeed':'阅读速度',
  'general.language':'语言','general.autoUpdate':'自动检查更新','general.telemetry':'匿名使用数据','general.shortcuts':'自定义快捷键 JSON','export.pandocPath':'Pandoc 路径','general.serviceSource':'更新源'
};
const CHOICES: Partial<Record<SettingsKey,string[]>> = { 'file.startup':['new','last'], 'file.dropFolder':['open','ignore'], 'file.dropMarkdown':['open','insert'], 'file.dropImport':['import','ignore'], 'editor.lineEnding':['LF','CRLF'], 'image.strategy':['none','copy','upload'], 'image.uploader':['none','picgo-core','picgo','piclist','custom'], 'markdown.headingStyle':['atx','setext'], 'markdown.unorderedMarker':['-','*','+'], 'markdown.orderedMarker':['increment','one'], 'markdown.smartMode':['input','render'], 'appearance.windowStyle':['classic','integrated'], 'appearance.theme':['github','newsprint','night','pixyll','whitey','custom'], 'appearance.darkTheme':['github','newsprint','night','pixyll','whitey','custom'], 'general.language':['auto','zh-CN','en'], 'math.htmlRepresentation':['svg','mathml','source'] };
export const SETTINGS_SCHEMA: readonly SettingDefinition[] = Object.entries(DEFAULT_SETTINGS).map(([key,value]) => {
  const typed = key as SettingsKey;
  const numeric = typeof value === 'number';
  return { key: typed, category: CATEGORIES[key.split('.')[0]], label: LABELS[typed] ?? key, type: typeof value as SettingDefinition['type'], scope: key.startsWith('export.') ? 'export' : 'global', effect: key==='appearance.windowStyle' ? 'restart' : 'immediate', choices: CHOICES[typed], ...(numeric ? { min: key.includes('readingSpeed') ? 1 : key.includes('zoom') ? 25 : 1, max: key.includes('readingSpeed') ? 5000 : key.includes('zoom') ? 300 : key.includes('fontSize') ? 72 : 16 } : {}) };
});
export function validateSetting(key: string, value: unknown): Result<void> {
  const spec = SETTINGS_SCHEMA.find(item => item.key === key);
  if (!spec) return failure('UNKNOWN_SETTING', `未知设置：${key}`);
  if (typeof value !== spec.type) return failure('SETTING_TYPE', `设置类型错误：${spec.label}`);
  if (typeof value === 'number' && (!Number.isFinite(value) || value < spec.min! || value > spec.max!)) return failure('SETTING_RANGE', `设置超出范围：${spec.label}`);
  if (spec.choices && !spec.choices.includes(String(value))) return failure('SETTING_CHOICE', `无效选项：${spec.label}`);
  if(key==='general.telemetryEndpoint'&&value){try{const url=new URL(String(value));if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error();}catch{return failure('SETTING_URL','接收端应使用 HTTPS 或本机 HTTP 地址');}}
  if (key === 'general.shortcuts' || key === 'image.uploadArgs' || key === 'export.profiles') { try { const parsed = JSON.parse(String(value)); if (key === 'general.shortcuts' ? !parsed || Array.isArray(parsed) || typeof parsed !== 'object' : key === 'image.uploadArgs' ? !Array.isArray(parsed) || parsed.some((item: unknown) => typeof item !== 'string') : !Array.isArray(parsed) || parsed.some((item: unknown) => !item || typeof item !== 'object' || !('id' in item) || !('format' in item))) throw new Error(); } catch { return failure('SETTING_JSON', '请输入有效 JSON 配置'); } }
  return success(undefined);
}
export class SettingsStore {
  private values: SettingsSnapshot = { ...DEFAULT_SETTINGS };
  private listeners = new Set<() => void>();
  getSnapshot = (): SettingsSnapshot => this.values;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  set(key: string, value: unknown): Result<void> { const check = validateSetting(key,value); if (!check.ok) return check; if(this.values[key as SettingsKey]===value)return success(undefined);this.values = { ...this.values, [key]: value }; this.listeners.forEach(listener => listener()); return success(undefined); }
  load(values: Record<string,unknown>) { const rejected: string[] = []; for (const [key,value] of Object.entries(values)) { if (!this.set(key,value).ok) rejected.push(key); } return rejected; }
  reset() { this.values = { ...DEFAULT_SETTINGS }; this.listeners.forEach(listener => listener()); }
}
