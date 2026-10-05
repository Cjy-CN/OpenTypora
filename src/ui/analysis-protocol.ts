import type {OutlineItem,TextStatistics} from './model';
export interface AnalysisInput {kind:'outline'|'statistics';text:string;speed:number;strict:boolean}
export interface AnalysisRequest extends AnalysisInput {id:number}
export type AnalysisResponse={id:number;ok:true;value:OutlineItem[]|TextStatistics}|{id:number;ok:false;error:string};
