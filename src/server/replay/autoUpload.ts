import { readFile, rm } from "node:fs/promises";
import type { ServerState } from "../core/state.js";
import { readReplayHeader, replayFilePath } from "./replayStorage.js";
import { uploadToShareStation, setReplayVisibility } from "../utils/shareStation.js";

export type AutoUploadHandler = (userId: number, chartId: number, timestamp: number, recordId: number) => void;

/**
 * 创建游戏结束时的自动上传处理器
 * 延迟30秒后执行上传
 */
export function createAutoUploadHandler(state: ServerState): AutoUploadHandler {
  return (userId: number, chartId: number, timestamp: number, _recordId: number): void => {
    // 检查服务端是否启用自动上传功能
    if (!state.config.replay_auto_upload) {
      state.logger.debug(`Auto upload skipped for user ${userId}: REPLAY_AUTO_UPLOAD disabled`);
      return;
    }

    // 检查分享站是否配置（未配置则保留本地文件）
    if (!state.shareStationConfigured || !state.shareStation) {
      state.logger.debug(`Auto upload skipped for user ${userId}: share station not configured, keeping local file`);
      return;
    }
    const shareStation = state.shareStation;

    // 延迟30秒后执行上传
    setTimeout(async () => {
      try {
        // 再次检查全局开关（可能在此期间被禁用）
        if (!state.config.replay_auto_upload) {
          return;
        }

        const baseDir = state.replayRecorder.baseDir;
        const filePath = replayFilePath(baseDir, userId, chartId, timestamp);

        // 验证文件存在
        const header = await readReplayHeader(filePath).catch(() => null);
        if (!header || header.userId !== userId || header.chartId !== chartId) {
          state.logger.warn(`Auto upload failed for user ${userId}: replay file not found or invalid`);
          return;
        }

        // 读取文件内容
        let fileBuffer: Buffer;
        try {
          fileBuffer = await readFile(filePath);
        } catch (err) {
          state.logger.error(`Auto upload failed for user ${userId}: failed to read file - ${err instanceof Error ? err.message : String(err)}`);
          return;
        }

        // 上传到分享站
        const uploadResult = await uploadToShareStation({
          fileBuffer,
          filename: `${timestamp}.phirarec`,
          chartName: header.chartName,
          username: header.userName,
          shareStation,
          outboundProxy: state.config.outbound_proxy
        });

        if (!uploadResult.success) {
          state.logger.error(`Auto upload failed for user ${userId}: ${uploadResult.message}`);
          return;
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
          // 限制每个 chart 最多保留 50 条元数据，防止内存泄漏
          if (chartMeta.length > 50) {
            chartMeta.splice(0, chartMeta.length - 50);
          }

          // 根据用户配置设置显示状态（默认不显示，show=true 时设为可见）
          const config = state.autoUploadConfigs.get(userId);
          if (config?.show) {
            await setReplayVisibility(uploadResult.scoreId, true, {
              shareStation,
              outboundProxy: state.config.outbound_proxy
            });
          }
        }

        state.logger.info(`Auto upload completed for user ${userId}, chart ${chartId}, scoreId: ${uploadResult.scoreId}`);

        // 上传成功后删除本地文件（只保留元数据）
        try {
          await rm(filePath);
          state.logger.debug(`Local replay file deleted for user ${userId}, chart ${chartId}, timestamp ${timestamp}`);
        } catch (err) {
          state.logger.warn(`Failed to delete local replay file for user ${userId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        state.logger.error(`Auto upload unexpected error for user ${userId}: ${msg}`);
      }
    }, 30000); // 30秒延迟
  };
}
