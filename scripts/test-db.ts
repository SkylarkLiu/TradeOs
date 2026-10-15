import { rmSync } from "node:fs";
for (const suffix of ["", "-wal", "-shm", ".tickflow.json"])
  rmSync(`data/unit.db${suffix}`, { force: true });
