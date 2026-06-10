import { GUI_HTML } from "../../gui/guiPage.js";
import type { RequestContext } from "./types.js";

/**
 * 提供服务端 GUI 页面：GET /gui
 *
 * 页面本身公开（不含任何敏感数据），其内部的数据接口
 * （/admin/metrics、/admin/rooms、/admin/console/* 与 WebSocket 订阅）
 * 均需管理员 token 鉴权。
 */
export function tryHandleGuiRoutes(ctx: RequestContext): boolean {
  const { req, res, url } = ctx;

  if (req.method !== "GET" || (url.pathname !== "/gui" && url.pathname !== "/gui/")) {
    return false;
  }

  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(GUI_HTML);
  return true;
}
