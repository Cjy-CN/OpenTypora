import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
function createRenderer(physics:boolean,numbering:boolean){
  // AllPackages registers Physics, but does not include it in its default package list.
  const packages=[...AllPackages.filter(name=>!['autoload','require','html','physics'].includes(name)),...(physics?['physics']:[])];
  const tex=new TeX({packages,tags:numbering?'all':'none'});
  return {tex,document:mathjax.document('',{InputJax:tex,OutputJax:new SVG({fontCache:'none'})})};
}
const renderers=new Map<string,ReturnType<typeof createRenderer>>();
/** The caller supplies the position in its document; cached engines never own document numbering. */
export function renderMathSvg(source:string,display:boolean,physics:boolean,numbering:boolean,equationIndex=1){
  if(!Number.isSafeInteger(equationIndex)||equationIndex<1)throw new RangeError('公式编号必须为正整数');
  const numbered=display&&numbering,key=`${physics}-${numbered}`;let renderer=renderers.get(key);
  if(!renderer){renderer=createRenderer(physics,numbered);renderers.set(key,renderer);}
  // TeX.reset clears counters, labels and IDs from the previous isolated conversion.
  renderer.tex.reset(equationIndex-1);
  return adaptor.innerHTML(renderer.document.convert(source,{display,em:16,ex:8,containerWidth:880}));
}
