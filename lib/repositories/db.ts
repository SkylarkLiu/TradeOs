import { PrismaClient } from '@/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const url=process.env.DATABASE_URL??'file:./data/tradeos.db';
mkdirSync(path.dirname(path.resolve(url.replace(/^file:/,''))),{recursive:true});
const globalDb=globalThis as unknown as {tradeosDb?:PrismaClient};
export const db=globalDb.tradeosDb??new PrismaClient({adapter:new PrismaBetterSqlite3({url})});
if(process.env.NODE_ENV!=='production')globalDb.tradeosDb=db;
