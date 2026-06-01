import { once } from "node:events";
import { createReadStream } from "node:fs";
import { stat, readFile, rm } from "node:fs/promises";
import { newUuid } from "../../../common/uuid.js";
import { fetchWithRetry } from "../../../common/http.js";
import { deleteReplayForUser, listReplaysForUser, readReplayHeader, replayFilePath } from "../../replay/replayStorage.js";
import { uploadToShareStation, setReplayVisibility } from "../../utils/shareStation.js";
import { cleanupExpiringMaps } from "../httpHelpers.js";
import type { RequestContext } from "./types.js";

/**
 * 处理玩家可见的回放相关路由（auth/download/delete/upload/auto-upload/config）
 */
export async function tryHandleReplayPublicRoutes(ctx: RequestContext): Promise<boolean> {
  const { req, res, url, state, services, write, read, verifyUserToken } = ctx;
  const { replaySessions, REPLAY_SESSION_TTL_MS } = services;

  if (req.method === "POST" && url.pathname === "/replay/auth") {
    const body = await read();
    const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
    if (!token) {
      write(400, { ok: false, error: "bad-token", message: ctx.t("bad-token") });
      return true;
    }

    cleanupExpiringMaps(replaySessions);

    const phiraApiEndpoint = state.config.phira_api_endpoint || "https://phira.5wyxi.com";
    const me = await fetchWithRetry(`${phiraApiEndpoint}/me`, {
      headers: { Authorization: `Bearer ${token}` },
      proxy: state.config.outbound_proxy
    }, 8000).then(async (r) => {
      if (!r.ok) throw new Error("auth-failed");
      return (await r.json()) as { id: number };
    }).catch(() => null);

    if (!me || !Number.isInteger(me.id)) {
      write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
      return true;
    }

    const baseDir = state.replayRecorder.baseDir;
    const listed = await listReplaysForUser(baseDir, me.id);
    const charts: Array<{
      chartId: number;
      replays: Array<{ timestamp: number; recordId: number; scoreId?: number; downloadUrl?: string }>;
    }> = [...listed.entries()].map(([chartId, replays]) => ({
      chartId,
      replays: replays.map((r) => ({ timestamp: r.timestamp, recordId: r.recordId }))
    }));

    // 合并已上传回放的元数据
    const userMeta = state.uploadedReplayMeta.get(me.id);
    if (userMeta) {
      for (const [chartId, metaList] of userMeta.entries()) {
        let chartEntry = charts.find((c) => c.chartId === chartId);
        if (!chartEntry) {
          chartEntry = { chartId, replays: [] };
          charts.push(chartEntry);
        }
        for (const meta of metaList) {
          const shareStation = state.shareStation;
          if (shareStation) {
            chartEntry.replays.push({
              timestamp: meta.timestamp,
              recordId: 0,
              scoreId: meta.scoreId,
              downloadUrl: `${shareStation.url}/download/replay/${meta.scoreId}`
            });
          }
        }
      }
    }

    // 对每个 chart 的 replays 按时间倒序排列
    for (const chart of charts) {
      chart.replays.sort((a, b) => b.timestamp - a.timestamp);
    }
    charts.sort((a, b) => a.chartId - b.chartId);

    const sessionToken = newUuid();
    const expiresAt = Date.now() + REPLAY_SESSION_TTL_MS;
    replaySessions.set(sessionToken, { userId: me.id, expiresAt });

    write(200, { ok: true, userId: me.id, charts, sessionToken, expiresAt });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/replay/download") {
    const sessionToken = (url.searchParams.get("sessionToken") ?? "").trim();
    const chartId = Number(url.searchParams.get("chartId") ?? "");
    const timestamp = Number(url.searchParams.get("timestamp") ?? "");
    if (!sessionToken || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
      write(400, { ok: false, error: "bad-request", message: ctx.t("bad-request") });
      return true;
    }

    cleanupExpiringMaps(replaySessions);

    const sess = replaySessions.get(sessionToken);
    if (!sess || Date.now() > sess.expiresAt) {
      write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
      return true;
    }

    const baseDir = state.replayRecorder.baseDir;
    const filePath = replayFilePath(baseDir, sess.userId, chartId, timestamp);
    const info = await stat(filePath).catch(() => null);

    // 本地文件存在，直接返回文件流
    if (info && info.isFile()) {
      const header = await readReplayHeader(filePath).catch(() => null);
      if (!header || header.userId !== sess.userId || header.chartId !== chartId) {
        write(404, { ok: false, error: "not-found", message: ctx.t("http-not-found") });
        return true;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-disposition", `attachment; filename="${timestamp}.phirarec"`);
      res.setHeader("content-length", String(info.size));

      const bytesPerSec = 50 * 1024;
      const startTime = Date.now();
      let totalSent = 0;
      const stream = createReadStream(filePath, { highWaterMark: 4096 });
      try {
        for await (const chunk of stream) {
          if (!res.write(chunk)) await once(res, "drain");
          totalSent += chunk.length;
          const elapsedMs = Date.now() - startTime;
          const targetMs = (totalSent / bytesPerSec) * 1000;
          const sleepMs = Math.max(0, Math.ceil(targetMs - elapsedMs));
          if (sleepMs > 0) await new Promise<void>((r) => setTimeout(r, sleepMs));
        }
        res.end();
      } catch {
        stream.destroy();
        res.end();
      }
      return true;
    }

    // 本地文件不存在，检查已上传的元数据
    const userMeta = state.uploadedReplayMeta.get(sess.userId);
    const chartMeta = userMeta?.get(chartId);
    const meta = chartMeta?.find((m) => m.timestamp === timestamp);
    if (meta && state.shareStation) {
      // 重定向到分享站下载链接
      const downloadUrl = `${state.shareStation.url}/download/replay/${meta.scoreId}`;
      res.statusCode = 302;
      res.setHeader("Location", downloadUrl);
      res.end();
      return true;
    }

    write(404, { ok: false, error: "not-found", message: ctx.t("http-not-found") });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/replay/delete") {
    const body = await read();
    const sessionToken = typeof (body as any)?.sessionToken === "string" ? String((body as any)?.sessionToken).trim() : "";
    const chartId = Number((body as any)?.chartId ?? "");
    const timestamp = Number((body as any)?.timestamp ?? "");
    if (!sessionToken || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
      write(400, { ok: false, error: "bad-request", message: ctx.t("bad-request") });
      return true;
    }

    cleanupExpiringMaps(replaySessions);

    const sess = replaySessions.get(sessionToken);
    if (!sess || Date.now() > sess.expiresAt) {
      write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
      return true;
    }

    // 先尝试删除本地文件
    const baseDir = state.replayRecorder.baseDir;
    const filePath = replayFilePath(baseDir, sess.userId, chartId, timestamp);
    const info = await stat(filePath).catch(() => null);
    if (info?.isFile()) {
      const header = await readReplayHeader(filePath).catch(() => null);
      if (header && header.userId === sess.userId && header.chartId === chartId) {
        const deleted = await deleteReplayForUser(baseDir, sess.userId, chartId, timestamp);
        if (deleted) {
          write(200, { ok: true });
          return true;
        }
      }
    }

    // 本地文件不存在，尝试从元数据中删除
    const userMeta = state.uploadedReplayMeta.get(sess.userId);
    if (userMeta) {
      const chartMeta = userMeta.get(chartId);
      if (chartMeta) {
        const idx = chartMeta.findIndex((m) => m.timestamp === timestamp);
        if (idx >= 0) {
          chartMeta.splice(idx, 1);
          if (chartMeta.length === 0) {
            userMeta.delete(chartId);
          }
          if (userMeta.size === 0) {
            state.uploadedReplayMeta.delete(sess.userId);
          }
          write(200, { ok: true });
          return true;
        }
      }
    }

    write(404, { ok: false, error: "not-found" });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/replay/upload") {
    const body = await read();
    const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
    const chartId = Number((body as any)?.chartId ?? "");
    const timestamp = Number((body as any)?.timestamp ?? "");

    if (!token || !Number.isInteger(chartId) || !Number.isInteger(timestamp) || chartId < 0 || timestamp <= 0) {
      write(400, { ok: false, error: "bad-request" });
      return true;
    }

    // 验证用户 TOKEN
    const userId = await verifyUserToken(token);
    if (userId === null) {
      write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
      return true;
    }

    // 检查分享站是否配置
    if (!state.shareStationConfigured) {
      write(503, { ok: false, error: "share-station-not-configured", message: ctx.t("share-station-not-configured") });
      return true;
    }

    // 获取回放文件路径
    const baseDir = state.replayRecorder.baseDir;
    const filePath = replayFilePath(baseDir, userId, chartId, timestamp);

    // 验证文件头和权限
    const header = await readReplayHeader(filePath).catch(() => null);
    if (!header || header.userId !== userId || header.chartId !== chartId) {
      write(404, { ok: false, error: "not-found", message: ctx.t("http-not-found") });
      return true;
    }

    // 检查文件是否存在
    const fileInfo = await stat(filePath).catch(() => null);
    if (!fileInfo || !fileInfo.isFile()) {
      write(404, { ok: false, error: "not-found", message: ctx.t("http-not-found") });
      return true;
    }

    // 读取文件内容
    let fileBuffer: Buffer;
    try {
      fileBuffer = await readFile(filePath);
    } catch {
      write(500, { ok: false, error: "upload-failed", message: ctx.t("upload-failed") });
      return true;
    }

    // 上传到分享站
    const uploadResult = await uploadToShareStation({
      fileBuffer,
      filename: `${timestamp}.phirarec`,
      chartName: header.chartName,
      username: header.userName,
      shareStation: state.shareStation!,
      outboundProxy: state.config.outbound_proxy
    });

    if (!uploadResult.success) {
      write(500, { ok: false, error: uploadResult.message || "upload-failed", message: ctx.t("upload-failed") });
      return true;
    }

    // 存储元数据
    if (uploadResult.scoreId) {
      let userMeta = state.uploadedReplayMeta.get(userId);
      if (!userMeta) {
        userMeta = new Map();
        state.uploadedReplayMeta.set(userId, userMeta);
      }
      let chartMeta = userMeta.get(chartId);
      if (!chartMeta) {
        chartMeta = [];
        userMeta.set(chartId, chartMeta);
      }
      chartMeta.push({ scoreId: uploadResult.scoreId, chartId, timestamp });

      // 手动上传默认设置为显示
      await setReplayVisibility(uploadResult.scoreId, true, {
        shareStation: state.shareStation!,
        outboundProxy: state.config.outbound_proxy
      });

      // 上传成功后删除本地文件
      try {
        await rm(filePath);
      } catch (err) {
        state.logger.warn(`Failed to delete local replay file after manual upload for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    write(200, {
      ok: true,
      userId,
      chartId,
      recordId: header.recordId || 0,
      scoreId: uploadResult.scoreId,
      message: "upload-success"
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/replay/auto-upload/config") {
    const token = (url.searchParams.get("token") ?? "").trim();
    if (!token) {
      write(400, { ok: false, error: "bad-token", message: ctx.t("bad-token") });
      return true;
    }

    // 验证用户 TOKEN
    const userId = await verifyUserToken(token);
    if (userId === null) {
      write(401, { ok: false, error: "unauthorized", message: ctx.t("auth-unauthorized") });
      return true;
    }

    // 获取或创建用户配置（show 默认 false）
    let config = state.autoUploadConfigs.get(userId);
    if (!config) {
      config = { show: false };
      state.autoUploadConfigs.set(userId, config);
    }

    write(200, {
      ok: true,
      userId,
      show: config.show,
      shareStationConfigured: state.shareStationConfigured,
      autoUploadEnabled: Boolean(state.config.replay_auto_upload)
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/replay/auto-upload/config") {
    const body = await read();
    const token = typeof (body as any)?.token === "string" ? String((body as any).token).trim() : "";
    const show = (body as any)?.show;

    if (!token) {
      write(400, { ok: false, error: "bad-token" });
      return true;
    }

    // 验证用户 TOKEN
    const userId = await verifyUserToken(token);
    if (userId === null) {
      write(401, { ok: false, error: "unauthorized" });
      return true;
    }

    // 获取或创建用户配置（show 默认 false）
    let config = state.autoUploadConfigs.get(userId);
    if (!config) {
      config = { show: false };
    }

    // 更新配置
    if (typeof show === 'boolean') {
      config.show = show;
    }

    state.autoUploadConfigs.set(userId, config);

    write(200, {
      ok: true,
      userId,
      show: config.show,
      shareStationConfigured: state.shareStationConfigured,
      autoUploadEnabled: Boolean(state.config.replay_auto_upload)
    });
    return true;
  }

  return false;
}
