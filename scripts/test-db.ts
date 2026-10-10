import { rmSync } from "node:fs";
for (const suffix of ["", "-wal", "-shm"])
  rmSync(`data/unit.db${suffix}`, { force: true });
