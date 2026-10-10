import {NextResponse} from 'next/server';
import {fireState} from '@/lib/services/fire';
export async function GET(request:Request){try{return NextResponse.json(await fireState({goalId:new URL(request.url).searchParams.get('id')??undefined}),{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({error:(e as Error).message},{status:400})}}
