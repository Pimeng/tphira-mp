import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolve } from "node:path";

export function readAppVersion(): string {
  const env1 = process.env.PHIRA_MP_VERSION?.trim();
  if (env1) return env1;
  const env2 = process.env.npm_package_version?.trim();
  if (env2) return env2;

  const argv1 = process.argv[1] ? resolve(process.argv[1]) : null;
  const entryDir = argv1 ? dirname(argv1) : null;
  const candidates = [
    join(process.cwd(), "package.json"),
    ...(entryDir ? [join(entryDir, "..", "..", "package.json"), join(entryDir, "..", "..", "..", "package.json")] : []),
    join(dirname(process.execPath), "package.json")
  ];

  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const text = readFileSync(p, "utf8");
      const json = JSON.parse(text) as { version?: unknown };
      if (typeof json.version === "string" && json.version.trim().length > 0) return json.version.trim();
    } catch {
      continue;
    }
  }

  return "unknown";
}

