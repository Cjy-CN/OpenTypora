import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
const adaptor=liteAdaptor();RegisterHTMLHandler(adaptor);
const documents=new Map<string,ReturnType<typeof mathjax.document>>();
export function renderMathSvg(source:string,display:boolean,physics:boolean,numbering:boolean){
  const key=`${physics}-${numbering}`;let document=documents.get(key);
  if(!document){document=mathjax.document('',{InputJax:new TeX({packages:AllPackages.filter(name=>!['autoload','require','html'].includes(name)&&(physics||name!=='physics')),tags:numbering?'ams':'none'}),OutputJax:new SVG({fontCache:'none'})});documents.set(key,document);}
  return adaptor.innerHTML(document.convert(source,{display,em:16,ex:8,containerWidth:880}));
}
