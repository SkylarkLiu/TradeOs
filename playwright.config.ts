import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir:'tests/e2e', workers:1, use:{baseURL:'http://127.0.0.1:3101'}, webServer:{command:'npx tsx scripts/e2e-db.ts && DATABASE_URL=file:./data/e2e.db npm run db:setup && DATABASE_URL=file:./data/e2e.db npm run dev -- --port 3101', url:'http://127.0.0.1:3101', reuseExistingServer:false, timeout:120000} });
