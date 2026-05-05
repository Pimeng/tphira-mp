import { fetchWithTimeout } from "../../common/http.js";
import { encodeMultipartFormData } from "../network/httpHelpers.js";

export type ShareStationConfig = {
  url: string;
  token: string;
};

/**
 * 上传文件到分享站
 */
export async function uploadToShareStation(
  opts: {
    fileBuffer: Buffer;
    filename: string;
    chartName?: string;
    username?: string;
    illustration?: string;
    chartLink?: string;
    shareStation: ShareStationConfig;
    outboundProxy?: string | false;
  }
): Promise<{ success: boolean; replayId?: string; scoreId?: number; message?: string }> {
  const { fileBuffer, filename, chartName, username, illustration, chartLink, shareStation, outboundProxy } = opts;

  const uploadUrl = `${shareStation.url}/upload_direct`;

  try {
    const fields: Parameters<typeof encodeMultipartFormData>[0] = [
      { name: "file", value: fileBuffer, filename }
    ];
    if (chartName) fields.push({ name: "chart_name", value: chartName });
    if (username) fields.push({ name: "username", value: username });
    if (illustration) fields.push({ name: "illustration", value: illustration });
    if (chartLink) fields.push({ name: "chart_link", value: chartLink });
    const { body, contentType } = encodeMultipartFormData(fields);

    const response = await fetchWithTimeout(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${shareStation.token}`,
        "Content-Type": contentType,
        "Content-Length": body.length.toString()
      },
      body,
      proxy: outboundProxy
    }, 60000);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      return { success: false, message: `upload-failed: ${errorText}` };
    }

    // 按 API 文档，/upload_direct 响应仅保证返回 replay_id
    const result = (await response.json()) as { replay_id?: string };

    // 解析 replay_id 获取 score_id
    // 格式为 "{user_id}_{chart_id}_{score_id}.phirarec"（分享站约定格式）
    const replayId = result.replay_id || "";
    const scoreIdMatch = /_(\d+)\.phirarec$/.exec(replayId);
    const scoreId = scoreIdMatch ? parseInt(scoreIdMatch[1]!, 10) : undefined;

    return {
      success: true,
      replayId,
      scoreId
    };
  } catch (error) {
    return { success: false, message: "upload-failed" };
  }
}

/**
 * 设置回放在分享站的显示状态
 */
export async function setReplayVisibility(
  scoreId: number,
  visible: boolean,
  opts: {
    shareStation: ShareStationConfig;
    outboundProxy?: string | false;
  }
): Promise<boolean> {
  const { shareStation, outboundProxy } = opts;
  const endpoint = visible ? `/show/${scoreId}` : `/hide/${scoreId}`;
  const url = `${shareStation.url}${endpoint}`;

  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${shareStation.token}`
      },
      proxy: outboundProxy
    }, 10000);

    return response.ok;
  } catch {
    return false;
  }
}
