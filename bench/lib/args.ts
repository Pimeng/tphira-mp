export type ConnectBenchArgs = {
  host: string;
  port: number;
  clients: number;
  rate: number;
  duration: number;
  token: string;
};

export type RoomBenchArgs = {
  host: string;
  port: number;
  rooms: number;
  playersPerRoom: number;
  monitorsPerRoom: number;
  rate: number;
  duration: number;
  tokens: string[];
  hz?: number;
};

export function parseConnectArgs(argv: string[]): ConnectBenchArgs {
  const args: ConnectBenchArgs = {
    host: "127.0.0.1",
    port: 12346,
    clients: 10,
    rate: 10,
    duration: 30,
    token: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--host":
        args.host = argv[++i] ?? args.host;
        break;
      case "--port":
        args.port = Number(argv[++i]) || args.port;
        break;
      case "--clients":
        args.clients = Number(argv[++i]) || args.clients;
        break;
      case "--rate":
        args.rate = Number(argv[++i]) || args.rate;
        break;
      case "--duration":
        args.duration = Number(argv[++i]) || args.duration;
        break;
      case "--token":
        args.token = argv[++i] ?? args.token;
        break;
    }
  }

  if (!args.token) {
    args.token = process.env.BENCH_TOKEN ?? "";
  }

  return args;
}

export function parseRoomArgs(argv: string[]): RoomBenchArgs {
  const args: RoomBenchArgs = {
    host: "127.0.0.1",
    port: 12346,
    rooms: 5,
    playersPerRoom: 2,
    monitorsPerRoom: 0,
    rate: 10,
    duration: 30,
    tokens: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--host":
        args.host = argv[++i] ?? args.host;
        break;
      case "--port":
        args.port = Number(argv[++i]) || args.port;
        break;
      case "--rooms":
        args.rooms = Number(argv[++i]) || args.rooms;
        break;
      case "--players-per-room":
        args.playersPerRoom = Number(argv[++i]) || args.playersPerRoom;
        break;
      case "--monitors-per-room":
        args.monitorsPerRoom = Number(argv[++i]) || args.monitorsPerRoom;
        break;
      case "--rate":
        args.rate = Number(argv[++i]) || args.rate;
        break;
      case "--duration":
        args.duration = Number(argv[++i]) || args.duration;
        break;
      case "--hz":
        args.hz = Number(argv[++i]) || args.hz;
        break;
      case "--tokens":
        args.tokens = (argv[++i] ?? "").split(",").filter((t) => t.length > 0);
        break;
      case "--token":
        {
          const t = argv[++i] ?? "";
          if (t) args.tokens.push(t);
        }
        break;
    }
  }

  if (args.tokens.length === 0) {
    const env = process.env.BENCH_TOKEN ?? "";
    if (env) args.tokens = [env];
  }

  return args;
}

export function printConnectHelp(): void {
  console.log(`Usage: pnpm run bench:connect -- [options]

Options:
  --host      <string>   Server host (default: 127.0.0.1)
  --port      <number>   Server port (default: 12346)
  --clients   <number>   Target concurrent clients (default: 10)
  --rate      <number>   New connections per second (default: 10)
  --duration  <number>   Benchmark duration in seconds (default: 30)
  --token     <string>   Auth token (or set BENCH_TOKEN env)
`);
}

export function printRoomHelp(): void {
  console.log(`Usage: pnpm run bench:room -- [options]

Options:
  --host                <string>   Server host (default: 127.0.0.1)
  --port                <number>   Server port (default: 12346)
  --rooms               <number>   Target rooms (default: 5)
  --players-per-room    <number>   Players per room (default: 2)
  --monitors-per-room   <number>   Monitors per room (default: 0)
  --rate                <number>   Operations per second (default: 10)
  --duration            <number>   Benchmark duration in seconds (default: 30)
  --token               <string>   Auth token (or set BENCH_TOKEN env)
`);
}
