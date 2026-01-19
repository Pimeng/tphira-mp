import { parseArgs } from "node:util";
import { startServer } from "./server.js";

function parsePort(argv: string[]): number | undefined {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: {
        type: "string",
        short: "p"
      }
    },
    allowPositionals: true
  });

  if (values.port === undefined) return undefined;
  const port = Number(values.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("端口号不合法");
  }
  return port;
}

async function main(): Promise<void> {
  const port = parsePort(process.argv.slice(2));
  const running = await startServer({ port });

  const stop = async () => {
    try {
      await running.close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
