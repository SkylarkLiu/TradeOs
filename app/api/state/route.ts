import { NextResponse } from "next/server";
import { getState } from "@/lib/services/state";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const currency = new URL(request.url).searchParams.get("currency") ?? "CNY";
  if (!["CNY", "USD", "USDT"].includes(currency))
    return NextResponse.json({ error: "报告币种无效" }, { status: 400 });
  return NextResponse.json(await getState(currency), {
    headers: { "Cache-Control": "no-store" },
  });
}
