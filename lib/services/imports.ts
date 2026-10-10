import Papa from "papaparse";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/repositories/db";
import { transactionSchema, postLedger, audit } from "./wealth";
import { D, canonical } from "@/lib/calculations/decimal";
const inputSchema = z.object({
  csv: z.string().min(1).max(10_000_000),
  mapping: z.record(z.string(), z.string()),
  name: z.string().max(200).default("CSV流水"),
});
export function parseImport(raw: unknown) {
  const input = inputSchema.parse(raw);
  const parsed = Papa.parse<Record<string, string>>(input.csv, {
    header: true,
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length)
    throw new Error(
      parsed.errors
        .map((e) => `第${(e.row ?? 0) + 2}行：${e.message}`)
        .join("；"),
    );
  if (parsed.data.length > 10000) throw new Error("单批最多10000行");
  const rows = parsed.data.map((row, i) => {
    const values: Record<string, string> = {};
    for (const [target, source] of Object.entries(input.mapping)) {
      if (source && row[source] !== undefined) values[target] = row[source];
    }
    for (const key of ["price", "fee", "externalId", "note", "purpose"])
      if (values[key] !== undefined && !values[key].trim()) delete values[key];
    const result = transactionSchema.safeParse(values);
    if (!result.success)
      return {
        row: i + 2,
        data: null,
        externalId: null,
        error: result.error.issues
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join("；"),
      };
    const data = result.data;
    const fingerprint = JSON.stringify([
      data.accountId,
      data.assetId,
      data.type,
      data.quantity,
      data.price,
      data.fee,
      data.at.toISOString(),
    ]);
    const externalId =
      data.externalId ??
      `csv:${createHash("sha256").update(fingerprint).digest("hex")}`;
    return {
      row: i + 2,
      data: { ...data, externalId },
      externalId,
      error: null,
    };
  });
  return {
    input,
    rows,
    hash: createHash("sha256")
      .update(JSON.stringify(rows.map((r) => r.data)))
      .digest("hex"),
  };
}
export async function importCommand(action: string, raw: unknown) {
  const batch = parseImport(raw);
  const ids = batch.rows.flatMap((r) => (r.externalId ? [r.externalId] : [])),
    existing = await db.assetTransaction.findMany({
      where: { externalId: { in: ids } },
      select: { externalId: true },
    }),
    known = new Set(existing.map((r) => r.externalId));
  const seen = new Set<string>();
  const rows = batch.rows.map((r) => {
    const duplicate =
      !!r.externalId && (known.has(r.externalId) || seen.has(r.externalId));
    if (r.externalId) seen.add(r.externalId);
    return { ...r, duplicate };
  });
  if (action === "import.preview")
    return {
      rows,
      count: rows.filter((r) => !r.error && !r.duplicate).length,
      errors: rows.filter((r) => r.error).length,
      duplicates: rows.filter((r) => r.duplicate).length,
      hash: batch.hash,
    };
  if (rows.some((r) => r.error))
    throw new Error("存在格式错误，修正后重新预览");
  return db.$transaction(
    async (tx) => {
      const old = await tx.importBatch.findUnique({
        where: { hash: batch.hash },
      });
      if (old) return { batch: old, imported: 0, duplicates: rows.length };
      const fresh = rows
        .filter((r) => !r.duplicate && r.data)
        .sort((a, b) => a.data!.at.getTime() - b.data!.at.getTime());
      for (const r of fresh) {
        try {
          await postLedger(tx, r.data!);
        } catch (e) {
          throw new Error(
            `第${r.row}行：${e instanceof Error ? e.message : "导入失败"}；整批未写入`,
          );
        }
      }
      const record = await tx.importBatch.create({
        data: {
          hash: batch.hash,
          name: batch.input.name,
          status: "COMPLETED",
          count: fresh.length,
          rows: {
            create: rows.map((r) => ({
              row: r.row,
              externalId: r.externalId!,
              status: r.duplicate ? "DUPLICATE" : "IMPORTED",
              detail: JSON.stringify(r.data),
            })),
          },
        },
      });
      await audit(tx, "IMPORT_COMMIT", record.id, { count: fresh.length });
      return {
        batch: record,
        imported: fresh.length,
        duplicates: rows.length - fresh.length,
      };
    },
    { timeout: 60000 },
  );
}
export function safeCsv(rows: Record<string, unknown>[]) {
  // Keep plain negative decimals numeric while escaping executable spreadsheet text.
  return Papa.unparse(rows, {
    escapeFormulae: /^[=+@\t\r]|^-(?!\d+(?:\.\d+)?$)/,
  });
}

// Ledger quantities are net deltas; the import contract expects gross quantities.
export function exportQuantity(row: {
  type: string;
  quantity: string;
  fee: string;
  asset: { assetClass: string };
}) {
  const outgoing = ["SELL", "WITHDRAWAL", "FEE"].includes(row.type);
  const standalone = [
    "BUY",
    "SELL",
    "DEPOSIT",
    "WITHDRAWAL",
    "DIVIDEND",
    "INTEREST",
    "FEE",
    "ADJUSTMENT",
  ].includes(row.type);
  const gross =
    row.asset.assetClass === "CASH" && standalone
      ? D(row.quantity).plus(row.fee)
      : D(row.quantity);
  return canonical(outgoing ? gross.abs() : gross);
}
