import { parseArgs } from "node:util";

function parsePort(argv: string[]): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: {
        type: "string",
        short: "p",
        default: "12346"
      }
    },
    allowPositionals: true
  });

  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("端口号不合法");
  }
  return port;
}

async function main(): Promise<void> {
  const port = parsePort(process.argv.slice(2));
  const { startServer } = await import("./server.js");
  await startServer({ port });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
