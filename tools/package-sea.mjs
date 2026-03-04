import { mkdirSync, copyFileSync, existsSync, rmSync, cpSync, writeFileSync } from "node:fs";
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
  if (res.status !== 0) throw new Error(`命令失败：${cmd} ${args.join(" ")}`);
}

function runPnpm(args) {
  const execPath = process.env.npm_execpath;
  if (execPath && execPath.toLowerCase().includes("pnpm")) {
    const res = spawnSync(process.execPath, [execPath, ...args], { stdio: "inherit", shell: false });
    if (res.error) throw res.error;
    if (res.status !== 0) throw new Error(`命令失败：pnpm ${args.join(" ")}`);
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
  const args = [
    "postject",
    outBin,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    seaSentinel(),
    "--overwrite"
  ];
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

runPnpm(["exec", ...postjectArgs(outBin, "dist-sea/sea-prep.blob")]);

const localesSrc = "locales";
if (existsSync(localesSrc)) {
  cpSync(localesSrc, join("release", "locales"), { recursive: true, force: true });
}

const configExample = "server_config.example.yml";
if (existsSync(configExample)) {
  copyFileSync(configExample, join("release", "server_config.yml"));
}

console.log(`打包完成：${outBin}`);

