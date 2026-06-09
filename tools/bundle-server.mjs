import { build } from "esbuild";
import { readFileSync } from "node:fs";

let version = "unknown";
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (typeof pkg?.version === "string") version = pkg.version;
} catch {}

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist-bundle/server.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  define: {
    "process.env.PHIRA_MP_VERSION": JSON.stringify(version)
  },
  minify: true,
  sourcemap: false,
  logLevel: "info"
});
