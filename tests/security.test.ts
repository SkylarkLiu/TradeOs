import { it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
it("本地访问允许，恶意Host和Origin拒绝", () => {
  expect(
    proxy(
      new NextRequest("http://localhost:3000/api/state", {
        headers: { host: "localhost:3000" },
      }),
    ).status,
  ).toBe(200);
  expect(
    proxy(
      new NextRequest("http://localhost:3000/api/state", {
        headers: { host: "evil.example" },
      }),
    ).status,
  ).toBe(403);
  expect(
    proxy(
      new NextRequest("http://localhost:3000/api/command", {
        headers: { host: "localhost:3000", origin: "null" },
      }),
    ).status,
  ).toBe(403);
  expect(
    proxy(
      new NextRequest("http://localhost:3000/api/command", {
        headers: { host: "localhost:3000", origin: "https://evil.example" },
      }),
    ).status,
  ).toBe(403);
});
