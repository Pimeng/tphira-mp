/**
 * 服务端 GUI 窗口启动器
 *
 * 类似 Minecraft 服务端：启动时自动弹出一个独立的 GUI 程序窗口。
 * 实现方式是调用系统已安装的 Edge / Chrome 的「应用模式」（--app），
 * 得到一个无地址栏、无标签页、带独立任务栏图标的窗口，零新增依赖，
 * 与 SEA 单文件打包和 Docker 部署完全兼容。
 *
 * 浏览器探测顺序：Edge → Chrome →（Linux 另试 Chromium）→ 系统默认浏览器兜底。
 * 找不到任何浏览器时返回 false，由调用方提示手动访问。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 应用模式窗口的专用浏览器配置目录（与用户日常浏览器配置隔离，并记住窗口大小） */
function guiProfileDir(): string {
  return join(tmpdir(), "phira-mp-gui-profile");
}

/** 应用模式启动参数 */
function appModeArgs(url: string): string[] {
  return [
    `--app=${url}`,
    `--user-data-dir=${guiProfileDir()}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1380,860"
  ];
}

/**
 * 尝试启动一个进程；通过 spawn / error 事件判断可执行文件是否存在。
 * 成功拉起返回 true（进程已 detach，不随服务器退出而关闭）。
 */
function tryLaunch(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { detached: true, stdio: "ignore" });
    } catch {
      resolve(false);
      return;
    }
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => resolve(false));
  });
}

/** Windows 下常见的 Edge / Chrome 安装路径 */
function windowsBrowserCandidates(): string[] {
  const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const localAppData = process.env["LOCALAPPDATA"] ?? "";
  const suffixes = [
    "Microsoft\\Edge\\Application\\msedge.exe",
    "Google\\Chrome\\Application\\chrome.exe"
  ];
  const out: string[] = [];
  for (const suffix of suffixes) {
    for (const base of [programFilesX86, programFiles, localAppData]) {
      if (base) out.push(join(base, suffix));
    }
  }
  return out;
}

/**
 * 打开服务端 GUI 窗口。
 * @returns 是否成功拉起（false 表示需要提示用户手动访问 URL）
 */
export async function launchGuiWindow(url: string): Promise<boolean> {
  if (process.platform === "win32") {
    for (const exe of windowsBrowserCandidates()) {
      if (!existsSync(exe)) continue;
      if (await tryLaunch(exe, appModeArgs(url))) return true;
    }
    // 兜底：系统默认浏览器（普通标签页）。rundll32 方式无 shell 引号问题，URL 片段（#）可完整传递
    return tryLaunch("rundll32", ["url.dll,FileProtocolHandler", url]);
  }

  if (process.platform === "darwin") {
    // open -na 在应用不存在时以非零码退出但 spawn 本身成功，因此优先探测应用路径
    for (const app of ["Microsoft Edge", "Google Chrome"]) {
      if (!existsSync(`/Applications/${app}.app`)) continue;
      if (await tryLaunch("open", ["-na", app, "--args", ...appModeArgs(url)])) return true;
    }
    return tryLaunch("open", [url]);
  }

  // Linux / 其他：依次尝试 PATH 中的浏览器
  for (const bin of ["microsoft-edge", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    if (await tryLaunch(bin, appModeArgs(url))) return true;
  }
  return tryLaunch("xdg-open", [url]);
}
