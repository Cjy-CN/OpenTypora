import type { ExportFormat,ExportProfile } from '../shared/contracts';
export const EXPORT_TEMPLATES:{format:ExportFormat;name:string;extension:string}[]=[
 {format:'pdf',name:'PDF（文档渲染）',extension:'.pdf'},{format:'pdf-latex',name:'PDF（LaTeX / Pandoc）',extension:'.pdf'},
 {format:'html',name:'HTML（带样式）',extension:'.html'},{format:'html-plain',name:'HTML（无样式）',extension:'.html'},
 {format:'image',name:'图片',extension:'.png'},{format:'docx',name:'Word',extension:'.docx'},{format:'odt',name:'OpenOffice',extension:'.odt'},
 {format:'rtf',name:'RTF',extension:'.rtf'},{format:'epub',name:'Epub',extension:'.epub'},{format:'latex',name:'LaTeX',extension:'.tex'},
 {format:'mediawiki',name:'MediaWiki',extension:'.wiki'},{format:'rst',name:'reStructuredText',extension:'.rst'},{format:'textile',name:'Textile',extension:'.textile'},
 {format:'opml',name:'OPML',extension:'.opml'},{format:'markdown',name:'Markdown（其他方言）',extension:'.md'},{format:'native',name:'Native（Pandoc）',extension:'.native'},
 {format:'pandoc',name:'Pandoc 转换',extension:'.txt'},{format:'custom',name:'自定义转换',extension:'.txt'}
];
export function createExportProfile(format:ExportFormat):ExportProfile{const template=EXPORT_TEMPLATES.find(item=>item.format===format)!;return {id:crypto.randomUUID(),name:template.name,format,extension:template.extension,args:[],options:{pageSize:'A4',margins:'',theme:'current',pageBreakH1:false,header:'',footer:'',author:'',extraHtml:'',yamlOverride:false,retainOutline:false,head:'',body:'',width:640,quality:100,fontSize:24,referenceDoc:'',outputFormat:format==='markdown'?'commonmark':'',executable:'',template:''},openFile:false,openFolder:false};}
export const DEFAULT_EXPORT_PROFILES:ExportProfile[]=EXPORT_TEMPLATES.map(item=>({...createExportProfile(item.format),id:`builtin-${item.format}`}));
export function parseExportProfiles(value:unknown):ExportProfile[]{try{const values=typeof value==='string'?JSON.parse(value):value;if(!Array.isArray(values))return [...DEFAULT_EXPORT_PROFILES];const valid=values.filter((item):item is ExportProfile=>!!item&&typeof item.id==='string'&&typeof item.name==='string'&&EXPORT_TEMPLATES.some(template=>template.format===item.format)&&typeof item.extension==='string'&&Array.isArray(item.args)&&item.args.every((arg:unknown)=>typeof arg==='string')&&typeof item.options==='object'&&item.options!==null);return valid;}catch{return [...DEFAULT_EXPORT_PROFILES];}}
export function getExportProfiles(settings:Record<string,unknown>):ExportProfile[]{return parseExportProfiles(settings['export.profiles']);}
export function getSelectedExportProfile(settings:Record<string,unknown>):ExportProfile|undefined{const profiles=getExportProfiles(settings);return profiles.find(item=>item.id===settings['export.selectedProfile'])??profiles[0];}
