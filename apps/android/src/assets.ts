import { z } from "zod";
import { D, Decimal, canonical } from "@tradeos/core";
import {
  transactionSchema,
  spotLedgerChanges,
} from "@tradeos/core/spot-ledger";
import {
  id,
  text,
  currency,
  nonnegative,
  positive,
  date,
  decimal,
} from "@tradeos/core/validation";
import type { Statement } from "./sql";

export const assetSchema = z.object({
  id,
  code: text,
  name: text,
  assetClass: z.enum(["STOCK", "FUND", "CRYPTO", "OTHER"]),
  currency,
});
export const holdingSchema = z.object({
  accountId: id,
  assetId: id,
  quantity: nonnegative,
  cost: nonnegative,
  realized: decimal,
});
export const assetEntrySchema = transactionSchema
  .omit({ externalId: true, purpose: true })
  .extend({
    id,
    at: date.transform((d) => d.toISOString()),
    sequence: z.number().int().positive(),
    quantityDelta: decimal,
    cashDelta: decimal,
    costDelta: decimal,
    realizedDelta: decimal,
  });
export const priceSchema = z.object({
  id,
  assetId: id,
  price: positive,
  at: date.transform((d) => d.toISOString()),
});
export type Asset = z.infer<typeof assetSchema>;
export type Holding = z.infer<typeof holdingSchema>;
export type AssetEntry = z.infer<typeof assetEntrySchema>;
export type Price = z.infer<typeof priceSchema>;
export const assetStateSchema = z.object({
  assets: z.array(assetSchema).max(10000),
  holdings: z.array(holdingSchema).max(100000),
  assetEntries: z.array(assetEntrySchema).max(100000),
  prices: z.array(priceSchema).max(100000),
});
export type AssetState = z.infer<typeof assetStateSchema>;
export const emptyAssets = (): AssetState => ({
  assets: [],
  holdings: [],
  assetEntries: [],
  prices: [],
});
export const assetTables = [
  "CREATE TABLE IF NOT EXISTS Asset(id TEXT PRIMARY KEY,code TEXT NOT NULL UNIQUE,name TEXT NOT NULL,assetClass TEXT NOT NULL,currency TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS AssetHolding(accountId TEXT NOT NULL REFERENCES FinancialAccount(id) ON DELETE RESTRICT,assetId TEXT NOT NULL REFERENCES Asset(id) ON DELETE RESTRICT,quantity TEXT NOT NULL,cost TEXT NOT NULL,realized TEXT NOT NULL,PRIMARY KEY(accountId,assetId))",
  "CREATE TABLE IF NOT EXISTS AssetLedger(id TEXT PRIMARY KEY,accountId TEXT NOT NULL REFERENCES FinancialAccount(id) ON DELETE RESTRICT,assetId TEXT NOT NULL REFERENCES Asset(id) ON DELETE RESTRICT,type TEXT NOT NULL,quantity TEXT NOT NULL,price TEXT NOT NULL,fee TEXT NOT NULL,at TEXT NOT NULL,note TEXT NOT NULL,sequence INTEGER NOT NULL,quantityDelta TEXT NOT NULL,cashDelta TEXT NOT NULL,costDelta TEXT NOT NULL,realizedDelta TEXT NOT NULL,UNIQUE(accountId,sequence))",
  "CREATE INDEX IF NOT EXISTS AssetLedger_account_at ON AssetLedger(accountId,at)",
  "CREATE TABLE IF NOT EXISTS AssetPrice(id TEXT PRIMARY KEY,assetId TEXT NOT NULL REFERENCES Asset(id) ON DELETE RESTRICT,price TEXT NOT NULL,at TEXT NOT NULL,UNIQUE(assetId,at))",
];
export function insertRow(
  table: string,
  row: Record<string, string | number>,
): Statement {
  const keys = Object.keys(row);
  return {
    statement: `INSERT INTO ${table}(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
    values: keys.map((k) => row[k]),
  };
}
export function updatedHolding(
  old: Holding,
  changes: ReturnType<typeof spotLedgerChanges>,
): Holding {
  const quantity = D(old.quantity).plus(changes.quantity),
    cost = D(old.cost).plus(changes.costDelta);
  if (quantity.lt(0) || cost.lt("-0.00000000000000000001"))
    throw new Error("可用持仓不足");
  return {
    ...old,
    quantity: canonical(quantity),
    cost: quantity.eq(0) ? "0" : canonical(Decimal.max(0, cost)),
    realized: canonical(D(old.realized).plus(changes.realizedDelta)),
  };
}
export function portfolioGroups(
  accounts: { id: string; currency: string; balance: string }[],
  state: AssetState,
) {
  const currencies = [...new Set(accounts.map((a) => a.currency))];
  return currencies.map((currency) => {
    let value = D(0),
      missing = 0;
    for (const a of accounts.filter((a) => a.currency === currency)) {
      value = value.plus(a.balance);
      for (const h of state.holdings.filter(
        (h) => h.accountId === a.id && D(h.quantity).gt(0),
      )) {
        const price = state.prices
          .filter(
            (p) => p.assetId === h.assetId && new Date(p.at) <= new Date(),
          )
          .sort((a, b) => b.at.localeCompare(a.at))[0];
        if (price) value = value.plus(D(h.quantity).mul(price.price));
        else missing++;
      }
    }
    return { currency, value: canonical(value), missing };
  });
}
