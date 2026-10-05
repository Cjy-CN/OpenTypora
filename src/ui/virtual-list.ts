export const NAVIGATION_ROW_HEIGHT=40;
export const FILE_SUMMARY_ROW_HEIGHT=148;
export function virtualRange(total:number,scrollTop:number,viewport:number,rowHeight:number,overscan=8){const start=Math.max(0,Math.min(Math.max(0,total-1),Math.floor(scrollTop/rowHeight)-overscan)),end=Math.min(total,Math.ceil((scrollTop+viewport)/rowHeight)+overscan);return {start,end:Math.max(start,end)};}
