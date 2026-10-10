import {NextResponse} from 'next/server';
import {backtestState} from '@/lib/services/backtest';
export async function GET(request:Request){try{return NextResponse.json(await backtestState({sessionId:new URL(request.url).searchParams.get('id')}),{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({error:(e as Error).message},{status:400})}}
