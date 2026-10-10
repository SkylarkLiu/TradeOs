import Decimal from 'decimal.js';
Decimal.set({precision:40,rounding:Decimal.ROUND_HALF_EVEN});
export {Decimal};
export const D = (value:Decimal.Value) => new Decimal(value);
export const sum = (values:Decimal.Value[]) => values.reduce<Decimal>((a,b)=>a.plus(b),D(0));
export function canonical(value:Decimal.Value) { const d=D(value); if(!d.isFinite()) throw new Error('数值必须有限'); return d.toFixed(); }
export function contractPnl(instrument:string, direction:string, quantity:string, entry:string, exit:string, multiplier='1') {
 const q=D(quantity).mul(multiplier), sign=direction==='LONG'?1:-1;
 if(instrument==='INVERSE') return q.mul(D(1).div(entry).minus(D(1).div(exit))).mul(sign);
 return q.mul(D(exit).minus(entry)).mul(sign);
}
export function positionSize(input:{instrument:string; direction:string; entry:string; stop:string; equity:string; riskPercent:string; multiplier?:string}) {
 const {entry,stop,direction}=input;
 if(D(entry).lte(0)||D(stop).lte(0)||D(entry).eq(stop)) throw new Error('入场价和止损价必须为不同的正数');
 if(direction==='LONG'?D(stop).gte(entry):D(stop).lte(entry)) throw new Error('止损方向错误');
 if(D(input.equity).lte(0)||D(input.riskPercent).lte(0)||D(input.riskPercent).gt(100)) throw new Error('权益和风险预算无效');
 const risk=D(input.equity).mul(input.riskPercent).div(100);
 const unit=contractPnl(input.instrument,direction,'1',entry,stop,input.multiplier).abs();
 return {risk:canonical(risk),quantity:canonical(risk.div(unit))};
}
export function maxDrawdown(values:string[]) {
 let peak=D(0), drawdown=D(0); for(const v of values){const d=D(v);peak=Decimal.max(peak,d);if(peak.gt(0))drawdown=Decimal.max(drawdown,peak.minus(d).div(peak));} return canonical(drawdown);
}
export function tradeMetrics(trades:{realized:string;initialRisk:string;openedAt:Date|string;closedAt:Date|string|null}[]) {
 const closed=trades.filter(t=>t.closedAt), profits=closed.filter(t=>D(t.realized).gt(0)), losses=closed.filter(t=>D(t.realized).lt(0));
 const grossProfit=sum(profits.map(t=>t.realized)),grossLoss=sum(losses.map(t=>D(t.realized).abs().toFixed()));
 const rs=closed.filter(t=>D(t.initialRisk).gt(0)).map(t=>D(t.realized).div(t.initialRisk).toFixed());
 return {count:closed.length,winRate:closed.length?canonical(D(profits.length).div(closed.length)):null,profitFactor:grossLoss.gt(0)?canonical(grossProfit.div(grossLoss)):null,profitFactorReason:grossLoss.eq(0)?'无亏损交易，盈亏因子无有限值':null,expectancy:closed.length?canonical(sum(closed.map(t=>t.realized)).div(closed.length)):null,averageR:rs.length?canonical(sum(rs).div(rs.length)):null,averageHoldingHours:closed.length?canonical(sum(closed.map(t=>D(new Date(t.closedAt!).getTime()-new Date(t.openedAt).getTime()).div(3600000).toFixed())).div(closed.length)):null};
}
export function twr(periods:{begin:string;end:string;flowAtEnd:string}[]) {
 if(!periods.length||periods.some(p=>D(p.begin).lte(0)))return null;
 return canonical(periods.reduce((a,p)=>a.mul(D(p.end).minus(p.flowAtEnd).div(p.begin)),D(1)).minus(1));
}
export function xirr(flows:{amount:string;at:Date|string}[]) {
 if(flows.length<2||!flows.some(f=>D(f.amount).gt(0))||!flows.some(f=>D(f.amount).lt(0)))return {value:null,reason:'需要正负现金流'};
 const sorted=[...flows].sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime()), start=new Date(sorted[0].at).getTime();
 if(new Date(sorted.at(-1)!.at).getTime()===start)return {value:null,reason:'现金流日期不能全部相同'};
 const npv=(r:Decimal)=>sum(sorted.map(f=>D(f.amount).div(D(1).plus(r).pow(D(new Date(f.at).getTime()-start).div(365*86400000))).toFixed()));
 // ponytail: bounded root scan detects ambiguous roots; extend the scan if documented rates exceed this domain.
 const grid=['-0.9999','-0.99','-0.9','-0.5','0','0.1','0.5','1','2','5','10','100','1000'].map(D), brackets:[Decimal,Decimal][]=[];
 for(let i=0;i<grid.length-1;i++){const a=npv(grid[i]),b=npv(grid[i+1]);if(a.eq(0))brackets.push([grid[i],grid[i]]);else if(a.mul(b).lt(0))brackets.push([grid[i],grid[i+1]]);}
 if(brackets.length!==1)return {value:null,reason:brackets.length?'检测到多个解':'限定区间内无有效解'};
 let [lo,hi]=brackets[0];if(lo.eq(hi))return {value:canonical(lo),reason:null};
 for(let i=0;i<180;i++){const mid=lo.plus(hi).div(2),v=npv(mid);if(v.abs().lt('0.0000000001'))return {value:canonical(mid),reason:null};if(npv(lo).mul(v).lte(0))hi=mid;else lo=mid;}
 return {value:canonical(lo.plus(hi).div(2)),reason:null};
}
export function projectWealth(current:string,monthly:string,annual:string,inflation:string,months:number){
 const growth=D(1).plus(annual).pow(D(1).div(12)), inf=D(1).plus(inflation).pow(D(1).div(12));
 let value=D(current); const points=[{month:0,nominal:canonical(value),real:canonical(value)}];
 for(let m=1;m<=months;m++){value=value.mul(growth).plus(monthly);points.push({month:m,nominal:canonical(value),real:canonical(value.div(inf.pow(m)))});}return points;
}
export function requiredContribution(current:string,target:string,annual:string,months:number){if(months<=0)return null;const g=D(1).plus(annual).pow(D(1).div(12));const factor=g.eq(1)?D(months):g.pow(months).minus(1).div(g.minus(1));return canonical(Decimal.max(0,D(target).minus(D(current).mul(g.pow(months))).div(factor)));}
