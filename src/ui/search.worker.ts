import {replacementChanges,searchDocument} from './model';
import type {SearchMatch,SearchOptions} from '../shared/contracts';
self.onmessage=(event:MessageEvent<{kind?:'search'|'replace';text:string;query:string;replacement:string;options:SearchOptions;only?:SearchMatch}>)=>{
 const {kind,text,query,replacement,options,only}=event.data;
 if(kind!=='replace'){self.postMessage(searchDocument(text,query,options));return;}
 try{self.postMessage({ok:true,value:replacementChanges(text,query,replacement,options,only)});}catch(error){self.postMessage({ok:false,error:error instanceof Error?error.message:'替换计算失败。'});}
};
