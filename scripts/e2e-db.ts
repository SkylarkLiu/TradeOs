import { rmSync } from "node:fs";
for (const suffix of ["", "-wal", "-shm", ".tickflow.json"])
  rmSync(`data/e2e.db${suffix}`, { force: true });
