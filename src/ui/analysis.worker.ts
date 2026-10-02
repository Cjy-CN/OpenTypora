import {parseOutline,statistics} from './model';
self.onmessage=(event:MessageEvent<{kind:'outline'|'statistics';text:string;speed:number}>)=>{const {kind,text,speed}=event.data;self.postMessage(kind==='outline'?parseOutline(text):statistics(text,{anchor:0,head:0},speed));};
