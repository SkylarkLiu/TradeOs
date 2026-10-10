import { db } from "@/lib/repositories/db";
import { safeCsv, exportQuantity } from "@/lib/services/imports";
export async function GET() {
  const rows = await db.assetTransaction.findMany({
    include: { asset: true, fill: true },
    orderBy: [{ at: "asc" }, { sequence: "asc" }],
  });
  return new Response(
    "\uFEFF" +
      safeCsv(
        rows.map((r) => ({
          id: r.id,
          accountId: r.accountId,
          assetId: r.assetId,
          type: r.type,
          quantity: exportQuantity(r),
          ledgerQuantity: r.quantity,
          cashDelta: r.cashDelta,
          sequence: r.sequence,
          tradeId: r.fill?.tradeId ?? "",
          transferId: r.transferId ?? "",
          reversalOf: r.reversalOf ?? "",
          standaloneImport:
            !r.fill &&
            !r.transferId &&
            !r.reversalOf &&
            !r.type.startsWith("CONTRACT") &&
            r.type !== "REVERSAL",
          price: r.price,
          fee: r.fee,
          at: r.at.toISOString(),
          note: r.note,
          externalId: r.externalId ?? r.id,
        })),
      ),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="tradeos-transactions.csv"',
      },
    },
  );
}
