import {NextResponse} from 'next/server';
import {analytics} from '@/lib/services/analytics';
export async function GET(request:Request){try{const data=Object.fromEntries([...new URL(request.url).searchParams].filter(([,v])=>v!==''));return NextResponse.json(await analytics(data),{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({error:(e as Error).message},{status:400})}}
