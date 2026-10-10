import {wealthCommand} from './wealth';
import {importCommand} from './imports';
import {tradingCommand} from './trading';
export async function command(action:string,input:unknown){if(['strategy.','plan.','trade.','fill.','position.','attachment.'].some(p=>action.startsWith(p)))return tradingCommand(action,input);if(action.startsWith('import.'))return importCommand(action,input);return wealthCommand(action,input)}
