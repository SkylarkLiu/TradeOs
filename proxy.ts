import { NextResponse, type NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  let hostname = "";
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return NextResponse.json({ error: "主机无效" }, { status: 403 });
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname))
    return NextResponse.json(
      { error: "本地单用户模式仅允许回环地址" },
      { status: 403 },
    );
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      new URL(origin);
    } catch {
      return NextResponse.json({ error: "来源无效" }, { status: 403 });
    }
  }
  if (
    (origin && new URL(origin).host !== host) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return NextResponse.json({ error: "跨站请求已拒绝" }, { status: 403 });
  return NextResponse.next();
}
export const config = { matcher: "/api/:path*" };
