import {parseOutline,statistics} from './model';
self.onmessage=(event:MessageEvent<{kind:'outline'|'statistics';text:string;speed:number;strict?:boolean}>)=>{const {kind,text,speed,strict=true}=event.data;self.postMessage(kind==='outline'?parseOutline(text,strict):statistics(text,{anchor:0,head:0},speed));};
