import {parseOutline,statistics} from './model';
import type {AnalysisRequest,AnalysisResponse} from './analysis-protocol';
self.onmessage=(event:MessageEvent<AnalysisRequest>)=>{
 const {id,kind,text,speed,strict=true}=event.data;
 let response:AnalysisResponse;
 try{response={id,ok:true,value:kind==='outline'?parseOutline(text,strict):statistics(text,{anchor:0,head:0},speed)};}
 catch{response={id,ok:false,error:'后台文档分析失败，请重新打开文档或缩小文档。'};}
 self.postMessage(response);
};
