import {wealthCommand} from './wealth';
import {importCommand} from './imports';
export async function command(action:string,input:unknown){if(action.startsWith('import.'))return importCommand(action,input);return wealthCommand(action,input)}
