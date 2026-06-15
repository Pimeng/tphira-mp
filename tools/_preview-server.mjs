// 临时静态服务器：把 docs/gui-preview.html 作为根路径提供，供预览/截图使用。
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "docs/gui-preview.html");
const port = 4178;

createServer((_req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(readFileSync(file, "utf8"));
}).listen(port, () => console.log("gui-preview on http://localhost:" + port));
