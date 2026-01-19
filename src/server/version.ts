import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readAppVersion(): string {
  const candidates = [join(process.cwd(), "package.json"), join(dirname(process.execPath), "package.json")];

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

