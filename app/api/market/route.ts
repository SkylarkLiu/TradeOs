import { NextResponse } from "next/server";
import { marketLookup, marketStatus } from "@/lib/services/market";
import { TickFlowError } from "@/lib/integrations/tickflow";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const symbol = new URL(request.url).searchParams.get("symbol");
    if (symbol !== null && (!symbol.trim() || symbol.length > 40))
      return NextResponse.json(
        { error: "请输入有效证券代码" },
        { status: 400 },
      );
    return NextResponse.json(
      symbol ? await marketLookup(symbol) : await marketStatus(),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof TickFlowError ? e.message : "行情数据暂不可用" },
      { status: 400 },
    );
  }
}
