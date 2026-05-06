import type { CommandCtx } from "./types.js";

export async function handleIpBlacklist(ctx: CommandCtx, args: string[]): Promise<void> {
  const { logger, t, printer: { print, printError, printInfo, printSuccess } } = ctx;
  if (args.length === 0) {
    printError(t("cli-usage-ipblacklist"));
    return;
  }

  const subCmd = args[0]?.toLowerCase();

  if (subCmd === "list") {
    const blacklist = logger.getBlacklistedIps();
    if (blacklist.length === 0) {
      printInfo(t("cli-blacklist-empty"));
      return;
    }

    print("");
    print(t("cli-blacklist-header", { count: blacklist.length }));
    for (const item of blacklist) {
      const expiresInMin = Math.ceil(item.expiresIn / 60000);
      print(t("cli-blacklist-line", { ip: item.ip, minutes: expiresInMin }));
    }
    print("");
    return;
  }

  if (subCmd === "remove") {
    if (args.length < 2) {
      printError(t("cli-usage-ipblacklist-remove"));
      return;
    }
    const ip = args[1]!;
    logger.removeFromBlacklist(ip);
    printSuccess(t("cli-blacklist-removed", { ip }));
    return;
  }

  if (subCmd === "clear") {
    logger.clearBlacklist();
    printSuccess(t("cli-blacklist-cleared"));
    return;
  }

  printError(t("cli-ipblacklist-unknown-subcommand"));
}
