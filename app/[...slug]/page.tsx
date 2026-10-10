import { Workspace } from "@/components/workspace";
import { notFound } from "next/navigation";
const paths = [
  "wealth/platforms",
  "wealth/accounts",
  "wealth/assets",
  "wealth/transactions",
  "wealth/transfers",
  "wealth/allocation",
  "wealth/history",
  "wealth/reconciliation",
  "trading/dashboard",
  "trading/strategies",
  "trading/plans",
  "trading/trades",
  "trading/positions",
  "trading/backtest",
  "trading/reviews",
  "trading/analytics",
  "fire",
  "fire/forecast",
  "settings",
];
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const path = slug.join("/");
  if (!paths.includes(path)) notFound();
  const query = await searchParams;
  return (
    <Workspace
      path={`/${path}`}
      filters={{
        accountId:
          typeof query.accountId === "string" ? query.accountId : undefined,
        assetId: typeof query.assetId === "string" ? query.assetId : undefined,
      }}
    />
  );
}
