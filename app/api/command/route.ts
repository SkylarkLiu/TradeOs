import { NextResponse } from "next/server";
import { z } from "zod";
import { command } from "@/lib/services/command";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host"))
      return NextResponse.json({ error: "来源校验失败" }, { status: 403 });
    if (!request.headers.get("content-type")?.includes("application/json"))
      return NextResponse.json({ error: "请使用JSON请求" }, { status: 415 });
    const body = z
      .object({ action: z.string().max(100), input: z.unknown() })
      .parse(await request.json());
    return NextResponse.json({
      result: await command(body.action, body.input),
    });
  } catch (e) {
    const error =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("；")
        : e instanceof Error
          ? e.message
          : "操作失败";
    const message = /Unique constraint/.test(error)
      ? "记录已存在，请检查重复名称、日期或导入标识"
      : /Foreign key|No .* found|record.*not found/i.test(error)
        ? "关联记录不存在"
        : error;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
