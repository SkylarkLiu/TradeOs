import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({ resolve:{alias:{'@':path.resolve('.')}}, test:{env:{DATABASE_URL:'file:./data/unit.db'},include:['tests/**/*.test.ts'], fileParallelism:false} });
