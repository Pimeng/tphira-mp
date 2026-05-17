import { startMockAuthServer } from "./lib/mockAuthServer.js";

async function main() {
  const server = await startMockAuthServer(0);
  console.log(server.url);

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };

  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
