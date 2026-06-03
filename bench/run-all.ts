import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import { startMockAuthServer } from "./lib/mockAuthServer.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveServerPid(parentPid: number): Promise<number | null> {
  if (process.platform === "linux") {
    try {
      const children = execSync(
        `cat /proc/${parentPid}/task/${parentPid}/children 2>/dev/null || pgrep -P ${parentPid} 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (children) {
        const pids = children
          .split(/\s+/)
          .map(Number)
          .filter((n) => !Number.isNaN(n) && n > 0);
        if (pids.length > 0) return pids[0]!;
      }
    } catch {
      // ignore
    }
  } else if (process.platform === "win32") {
    try {
      const cmd = `powershell -NoProfile -Command "Get-WmiObject Win32_Process -Filter 'ParentProcessId=${parentPid}' | Select-Object ProcessId | ConvertTo-Json"`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
      if (!output) return null;
      const data = JSON.parse(output);
      if (Array.isArray(data)) {
        const pids = data.map((item) => item.ProcessId).filter((n: unknown) => typeof n === "number" && n > 0);
        if (pids.length > 0) return pids[0];
      } else if (data && typeof data.ProcessId === "number") {
        return data.ProcessId;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function runCommand(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = isWin
      ? spawn([cmd, ...args].join(" "), [], { stdio: "inherit", shell: true, env: { ...process.env, ...env } })
      : spawn(cmd, args, { stdio: "inherit", shell: false, env: { ...process.env, ...env } });
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

type BenchSuiteArgs = {
  host: string;
  port: number;
  tokens: string;
  duration: number;
  clients: number;
  rate: number;
  rooms: number;
  playersPerRoom: number;
  monitorsPerRoom: number;
  hz: number;
};

function parseArgs(argv: string[]): BenchSuiteArgs {
  const out: BenchSuiteArgs = {
    host: "127.0.0.1",
    port: 12346,
    tokens: "bench",
    duration: 30,
    clients: 5,
    rate: 2,
    rooms: 2,
    playersPerRoom: 2,
    monitorsPerRoom: 0,
    hz: 20
  };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--host":
        out.host = argv[++i] ?? out.host;
        break;
      case "--port":
        out.port = Number(argv[++i]) || out.port;
        break;
      case "--token": {
        const t = argv[++i] ?? "";
        if (t) out.tokens = out.tokens === "bench" ? t : `${out.tokens},${t}`;
        break;
      }
      case "--tokens":
        out.tokens = argv[++i] ?? out.tokens;
        break;
      case "--duration":
        out.duration = Number(argv[++i]) || out.duration;
        break;
      case "--clients":
        out.clients = Number(argv[++i]) || out.clients;
        break;
      case "--rate":
        out.rate = Number(argv[++i]) || out.rate;
        break;
      case "--rooms":
        out.rooms = Number(argv[++i]) || out.rooms;
        break;
      case "--players-per-room":
        out.playersPerRoom = Number(argv[++i]) || out.playersPerRoom;
        break;
      case "--monitors-per-room":
        out.monitorsPerRoom = Number(argv[++i]) || out.monitorsPerRoom;
        break;
      case "--hz":
        out.hz = Number(argv[++i]) || out.hz;
        break;
    }
  }
  if (!out.tokens || out.tokens === "bench") {
    out.tokens = process.env.BENCH_TOKEN ?? "bench";
  }
  return out;
}

async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tokenCount = args.tokens.split(",").filter((t) => t.length > 0).length;

  console.log("\n========== Benchmark Suite ==========");
  console.log(`  host:     ${args.host}`);
  console.log(`  port:     ${args.port}`);
  console.log(`  tokens:   ${tokenCount}`);
  console.log(`  duration: ${args.duration}s per bench`);
  console.log(`  connect:  ${args.clients} clients @ ${args.rate}/s`);
  console.log(`  room:     ${args.rooms} rooms × ${args.playersPerRoom} players`);
  console.log(`  gameplay: ${args.rooms} rooms × ${args.playersPerRoom} players @ ${args.hz} Hz`);
  console.log("=====================================\n");

  // 启动 mock 认证服务器（让每个 token 映射到不同用户 ID）
  console.log("Starting mock auth server...");
  const mockAuth = await startMockAuthServer(0);
  console.log(`Mock auth server running at ${mockAuth.url}\n`);

  // 准备服务端配置
  const createdConfig = !fs.existsSync("server_config.yml");
  if (createdConfig) {
    fs.copyFileSync("server_config.example.yml", "server_config.yml");
  }

  // 启动服务端（通过环境变量覆盖 phira_api_endpoint）
  // 优先使用生产构建 dist/server/main.js，避免 pnpm 产生的 ELIFECYCLE 污染日志
  const useProductionBuild = fs.existsSync("dist/server/main.js");
  console.log("Starting server...");
  const serverEnv = {
    ...process.env,
    BENCH_TOKEN: args.tokens,
    PHIRA_API_ENDPOINT: mockAuth.url
  };
  const isWin = process.platform === "win32";
  let server: ReturnType<typeof spawn>;
  if (useProductionBuild) {
    console.log("Using production build: dist/server/main.js");
    const nodeCmd = isWin ? "node.exe" : "node";
    server = spawn(nodeCmd, ["dist/server/main.js", "--port", String(args.port)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: serverEnv,
      shell: false
    });
  } else {
    console.log("Production build not found, falling back to pnpm run dev:server");
    server = isWin
      ? spawn("pnpm run dev:server", [], { stdio: ["ignore", "pipe", "pipe"], env: serverEnv, shell: true })
      : spawn("pnpm", ["run", "dev:server"], { stdio: ["ignore", "pipe", "pipe"], env: serverEnv, shell: false });
  }
  let serverLog = "";
  server.stdout?.on("data", (d) => {
    serverLog += d.toString();
  });
  server.stderr?.on("data", (d) => {
    serverLog += d.toString();
  });

  // 等待服务端就绪
  await sleep(3000);

  const rawPid = server.pid;
  let serverPid: number | undefined;
  if (rawPid) {
    const resolved = await resolveServerPid(rawPid);
    serverPid = resolved ?? rawPid;
    console.log(`Server PID detected: ${serverPid}${resolved ? ` (resolved from parent ${rawPid})` : ""}`);
  }

  console.log("Server should be ready.\n");

  const benchEnv = { BENCH_TOKEN: args.tokens };
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const tokenArgs = args.tokens.includes(",") ? ["--tokens", args.tokens] : ["--token", args.tokens];
  const serverPidArgs = serverPid ? ["--server-pid", String(serverPid)] : [];
  let exitCode = 0;

  // 1. Connect bench
  console.log("\n>>> Running connect-bench <<<\n");
  const connectCode = await runCommand(
    pnpm,
    [
      "run",
      "bench:connect",
      "--",
      "--host",
      args.host,
      "--port",
      String(args.port),
      "--clients",
      String(args.clients),
      "--rate",
      String(args.rate),
      "--duration",
      String(args.duration),
      ...tokenArgs,
      ...serverPidArgs
    ],
    benchEnv
  );
  if (connectCode !== 0) {
    console.warn(`connect-bench exited with code ${connectCode}`);
    exitCode = 1;
  }

  // 2. Room bench
  console.log("\n>>> Running room-bench <<<\n");
  const roomCode = await runCommand(
    pnpm,
    [
      "run",
      "bench:room",
      "--",
      "--host",
      args.host,
      "--port",
      String(args.port),
      "--rooms",
      String(args.rooms),
      "--players-per-room",
      String(args.playersPerRoom),
      "--monitors-per-room",
      String(args.monitorsPerRoom),
      "--rate",
      String(args.rate),
      "--duration",
      String(args.duration),
      ...tokenArgs,
      ...serverPidArgs
    ],
    benchEnv
  );
  if (roomCode !== 0) {
    console.warn(`room-bench exited with code ${roomCode}`);
    exitCode = 1;
  }

  // 3. Gameplay bench
  console.log("\n>>> Running gameplay-bench <<<\n");
  const gameplayCode = await runCommand(
    pnpm,
    [
      "run",
      "bench:gameplay",
      "--",
      "--host",
      args.host,
      "--port",
      String(args.port),
      "--rooms",
      String(args.rooms),
      "--players-per-room",
      String(args.playersPerRoom),
      "--monitors-per-room",
      String(args.monitorsPerRoom),
      "--rate",
      String(args.rate),
      "--hz",
      String(args.hz),
      "--duration",
      String(args.duration),
      ...tokenArgs,
      ...serverPidArgs
    ],
    benchEnv
  );
  if (gameplayCode !== 0) {
    console.warn(`gameplay-bench exited with code ${gameplayCode}`);
    exitCode = 1;
  }

  // 停止服务端
  console.log("\nStopping server...");
  server.kill("SIGTERM");
  await sleep(1000);
  if (!server.killed) {
    server.kill("SIGKILL");
  }

  // 停止 mock 认证服务器
  await mockAuth.stop();
  console.log("Mock auth server stopped.");

  // 保存服务端日志
  const benchResultsDir = "bench-results";
  if (!fs.existsSync(benchResultsDir)) {
    fs.mkdirSync(benchResultsDir, { recursive: true });
  }
  fs.writeFileSync(`${benchResultsDir}/server.log`, serverLog, "utf-8");
  console.log(`Server log saved to ${benchResultsDir}/server.log`);

  // 清理由本脚本创建的临时配置文件
  if (createdConfig) {
    fs.unlinkSync("server_config.yml");
  }

  console.log("\n========== Benchmark Suite Complete ==========");
  console.log("Results saved to bench-results/");
  console.log("==============================================\n");

  process.exit(exitCode);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
