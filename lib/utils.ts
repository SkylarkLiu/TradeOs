import {D} from './calculations/decimal';
export function amount(value:string|null|undefined,currency=''){if(value==null)return '数据不足';const [whole,dec]=D(value).toFixed(2).split('.');return `${currency?currency+' ':''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${dec}`}
export const pct=(v:string|null|undefined)=>v==null?'数据不足':`${D(v).mul(100).toFixed(2)}%`;
export const when=(s:string)=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
