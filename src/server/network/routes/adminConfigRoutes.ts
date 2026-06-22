import { persistConfigValues } from "../../core/configPersist.js";
import {
  buildRuntimeConfigSnapshot,
  parseRuntimeConfigPatch,
  pickRuntimeConfigSnapshot,
  RUNTIME_CONFIG_ENV_NAMES
} from "../../core/runtimeConfig.js";
import type { RequestContext } from "./types.js";

/**
 * 处理 admin 配置类路由：
 * - /admin/replay/config（GET/POST）
 * - /admin/room-creation/config（GET/POST）
 * - /admin/runtime-config（GET/POST）
 * - /admin/runtime-config/rollback（POST）
 */
export async function tryHandleAdminConfigRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, url, state, write, read } = ctx;

  const applyRuntimeConfigPatch = async (
    persistPatch: Record<string, boolean | number | string>,
    configPatch: Record<string, unknown>
  ): Promise<void> => {
    await persistConfigValues(state.configPath, persistPatch);
    if (state.runtimeConfigReloader) {
      await state.runtimeConfigReloader(configPatch);
    }
  };

  if (req.method === "GET" && url.pathname === "/admin/runtime-config") {
    write(200, {
      ok: true,
      managedKeys: RUNTIME_CONFIG_ENV_NAMES,
      rollbackAvailable: state.lastRuntimeConfigRollback !== null,
      config: buildRuntimeConfigSnapshot(state.config)
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/runtime-config") {
    const body = await read();
    const parsed = parseRuntimeConfigPatch(body);
    if (!parsed.ok) {
      write(400, {
        ok: false,
        error: "bad-runtime-config",
        message: ctx.t("bad-request"),
        invalidKeys: parsed.invalidKeys,
        startupOnlyKeys: parsed.startupOnlyKeys,
        unsupportedKeys: parsed.unsupportedKeys,
        managedKeys: RUNTIME_CONFIG_ENV_NAMES
      });
      return true;
    }

    const rollbackSnapshot = pickRuntimeConfigSnapshot(state.config, parsed.keys);
    await applyRuntimeConfigPatch(parsed.persistPatch, parsed.configPatch as Record<string, unknown>);
    state.lastRuntimeConfigRollback = rollbackSnapshot;

    write(200, {
      ok: true,
      updatedKeys: parsed.keys,
      rollbackAvailable: state.lastRuntimeConfigRollback !== null,
      config: buildRuntimeConfigSnapshot(state.config)
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/runtime-config/rollback") {
    if (!state.lastRuntimeConfigRollback) {
      write(409, { ok: false, error: "runtime-config-rollback-unavailable", message: ctx.t("bad-request") });
      return true;
    }

    const rollbackPatch = state.lastRuntimeConfigRollback;
    const rollbackParsed = parseRuntimeConfigPatch(rollbackPatch);
    if (!rollbackParsed.ok) {
      write(500, { ok: false, error: "runtime-config-rollback-invalid", message: ctx.t("http-internal-error") });
      return true;
    }

    const rollbackKeys = Object.keys(rollbackPatch);
    const nextRollbackSnapshot = pickRuntimeConfigSnapshot(state.config, rollbackKeys);
    await applyRuntimeConfigPatch(rollbackParsed.persistPatch, rollbackParsed.configPatch as Record<string, unknown>);
    state.lastRuntimeConfigRollback = nextRollbackSnapshot;

    write(200, {
      ok: true,
      updatedKeys: rollbackKeys,
      rollbackAvailable: state.lastRuntimeConfigRollback !== null,
      config: buildRuntimeConfigSnapshot(state.config)
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/replay/config") {
    write(200, { ok: true, enabled: state.replayEnabled });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/admin/room-creation/config") {
    write(200, { ok: true, enabled: state.roomCreationEnabled });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/room-creation/config") {
    const body = await read();
    const raw = (body ?? {}) as { enabled?: unknown };
    if (raw.enabled === undefined) {
      write(400, { ok: false, error: "bad-enabled", message: ctx.t("bad-enabled") });
      return true;
    }
    const parsed = parseRuntimeConfigPatch({ ROOM_CREATION_ENABLED: raw.enabled });
    if (!parsed.ok) {
      write(400, { ok: false, error: "bad-enabled", message: ctx.t("bad-enabled") });
      return true;
    }

    const rollbackSnapshot = pickRuntimeConfigSnapshot(state.config, parsed.keys);
    await applyRuntimeConfigPatch(parsed.persistPatch, parsed.configPatch as Record<string, unknown>);
    state.lastRuntimeConfigRollback = rollbackSnapshot;
    state.logger.info(`Runtime config persisted: ${parsed.keys.join(", ")}`);

    write(200, { ok: true, enabled: state.roomCreationEnabled });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/admin/replay/config") {
    const body = await read();
    const raw = (body ?? {}) as { enabled?: unknown };
    if (raw.enabled === undefined) {
      write(400, { ok: false, error: "bad-enabled", message: ctx.t("bad-enabled") });
      return true;
    }
    const parsed = parseRuntimeConfigPatch({ REPLAY_ENABLED: raw.enabled });
    if (!parsed.ok) {
      write(400, { ok: false, error: "bad-enabled", message: ctx.t("bad-enabled") });
      return true;
    }

    const rollbackSnapshot = pickRuntimeConfigSnapshot(state.config, parsed.keys);
    await applyRuntimeConfigPatch(parsed.persistPatch, parsed.configPatch as Record<string, unknown>);
    state.lastRuntimeConfigRollback = rollbackSnapshot;
    state.logger.info(`Runtime config persisted: ${parsed.keys.join(", ")}`);

    write(200, { ok: true, enabled: state.replayEnabled });
    return true;
  }

  return false;
}
