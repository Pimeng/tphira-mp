import { mkdirSync, copyFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

function resolveCmd(cmd) {
  if (process.platform !== "win32") return cmd;
  if (cmd === "pnpm") return "pnpm.cmd";
  return cmd;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(resolveCmd(cmd), args, { stdio: "inherit", shell: false, ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`执行命令失败：${cmd} ${args.join(" ")}`);
}

function runPnpm(args) {
  const execPath = process.env.npm_execpath;
  if (execPath && execPath.toLowerCase().includes("pnpm")) {
    const res = spawnSync(process.execPath, [execPath, ...args], { stdio: "inherit", shell: false });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`执行命令失败：pnpm ${args.join(" ")}`);
    return;
  }
  run("pnpm", args);
}

function seaSentinel() {
  return "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
}

function binName() {
  const base = "phira-mp-server";
  return process.platform === "win32" ? `${base}.exe` : base;
}

function nodePath() {
  const res = spawnSync(process.execPath, ["-p", "process.execPath"], { encoding: "utf8" });
  if (res.status !== 0) throw new Error("无法获取 node 路径");
  return res.stdout.trim();
}

function postjectArgs(outBin, blobPath) {
  const args = ["postject", outBin, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", seaSentinel(), "--overwrite"];
  if (process.platform === "darwin") {
    args.push("--macho-segment-name", "NODE_SEA");
  }
  return args;
}

mkdirSync("dist-bundle", { recursive: true });
mkdirSync("dist-sea", { recursive: true });
mkdirSync("release", { recursive: true });

if (existsSync("dist-sea/sea-prep.blob")) rmSync("dist-sea/sea-prep.blob");

runPnpm(["run", "build"]);
runPnpm(["run", "bundle:server"]);

const seaConfig = {
  main: "dist-bundle/server.cjs",
  output: "dist-sea/sea-prep.blob",
  disableExperimentalSEAWarning: true
};
writeFileSync("dist-sea/sea-config.json", JSON.stringify(seaConfig, null, 2));

run(process.execPath, ["--experimental-sea-config", "dist-sea/sea-config.json"]);

const outBin = join("release", binName());
copyFileSync(nodePath(), outBin);

// 注入前 strip 符号表与调试节（实测 Linux 约省 17MB、macOS 约省 25MB）。
// 必须在 postject 之前做：注入后 ELF 已被 LIEF 重写，再 strip 有损坏风险。
// macOS 用 -x 仅删本地符号（保留导出符号，脚本结尾会重新 ad-hoc 签名）；
// FreeBSD pkg 的 node 本身已 strip，此步为空操作；strip 缺失或失败时跳过不中断构建。
if (process.platform !== "win32") {
  try {
    console.log("正在 strip 可执行文件...");
    run("strip", process.platform === "darwin" ? ["-x", outBin] : [outBin]);
    console.log("strip 完成");
  } catch {
    console.log("strip 不可用或失败，跳过");
  }
}

runPnpm(["exec", ...postjectArgs(outBin, "dist-sea/sea-prep.blob")]);

// UPX 压缩仅 Windows 可用：postject(LIEF) 注入会把 ELF 程序头表挪到文件末尾，
// UPX 见到非常规 e_phoff 直接拒绝（bad e_phoff）；现代 macOS 二进制 UPX 已不支持。
// PE 注入不改动头部布局，故仅在 Windows 上压缩（可选，未安装或失败时不中断构建）。
if (process.platform === "win32") {
  try {
    console.log("正在使用 UPX 压缩可执行文件...");
    run("upx", ["--best", outBin]);
    console.log("UPX 压缩完成");
  } catch {
    console.log("UPX 不可用或压缩失败，跳过压缩");
  }
}

// macOS 代码签名
if (process.platform === "darwin") {
  console.log("正在对可执行文件进行代码签名...");
  run("codesign", ["--force", "--deep", "--sign", "-", outBin]);
}

// 不再随包附带 locales/ 与 server_config.yml：
// - locales 已通过 gen:locales 嵌入二进制（embeddedLocales.ts），并支持运行时在线拉取，
//   以及在运行目录 locales/<语言>.ftl 放局部 ftl 逐键覆盖（见 l10n.ts / README）；
// - 配置文件在首次启动时自动生成（本地示例 / 在线拉取 / 内置最小模板）。
// 因此发布产物仅为单个可执行文件。

console.log(`打包完成：${outBin}`);
