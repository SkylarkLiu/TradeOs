import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const schema = readFileSync("prisma/schema.prisma", "utf8");
const models = [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map(
  ([, name, body]) => ({
    name,
    fields: [
      ...body.matchAll(
        /^\s*(\w+)\s+(String|Int|Boolean|DateTime)(\?)?(?=\s|$)/gm,
      ),
    ].map(([, name, type, optional]) => ({
      name,
      type,
      kind: "scalar",
      isRequired: !optional,
    })),
  }),
);
if (!models.length) throw new Error("没有数据库模型");
mkdirSync("lib", { recursive: true });
writeFileSync(
  "lib/schema-metadata.json",
  JSON.stringify(models, null, 2) + "\n",
);
