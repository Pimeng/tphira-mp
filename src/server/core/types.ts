export type ShareStationConfig = {
  /** 分享站地址 */
  url: string;
  /** 服务端认证 token，用于自动上传等内部接口 */
  token: string;
};

export type RedisConfig = {
  /** 是否启用 Redis 缓存 */
  enabled: boolean;
  /** Redis 服务器地址，默认 127.0.0.1 */
  host?: string;
  /** Redis 服务器端口，默认 6379 */
  port?: number;
  /** Redis 认证密码 */
  password?: string;
  /** Redis 数据库号，默认 0 */
  db?: number;
};

export type ServerConfig = {
  monitors: number[];
  /** 测试账号 ID 列表。默认值：[1739989] */
  test_account_ids?: number[];
  server_name?: string;
  host?: string;
  port?: number;
  http_service?: boolean;
  http_port?: number;
  /** 是否在启动时打开服务端 GUI 窗口（基于系统浏览器应用模式）；启用时自动开启 http_service */
  gui?: boolean;
  room_max_users?: number;
  /** 是否允许玩家创建新房间，默认允许。服主可在运行时切换并持久化到配置文件 */
  room_creation_enabled?: boolean;
  /**
   * 对局（Playing）进行中断线的重连宽限时长（秒）。默认 5。
   * 0 表示关闭——保持旧行为：Playing 中断线立即判定离开本局。
   * >0 时给该玩家这么多秒重连回原局，期间其他已完成玩家会在结算前等待，上限 120 秒。
   */
  playing_reconnect_grace?: number;
  /** 是否启用玩家聊天，默认启用 */
  chat_enabled?: boolean;
  replay_enabled?: boolean;
  /** 回放录制基础目录，默认 process.cwd()/record */
  replay_base_dir?: string;
  /** 回放文件保留天数，过期后自动清理，默认 4 */
  replay_ttl_days?: number;
  admin_token?: string;
  admin_data_path?: string;
  room_list_tip?: string;
  /** 日志等级：DEBUG、INFO、MARK、WARN、ERROR，默认 INFO */
  log_level?: string;
  /** 日志压缩：历史日志超过该天数后按 gzip 压缩（日志重复率高，可大幅降低占用），0 表示关闭压缩，默认 14 */
  log_compress_after_days?: number;
  /** 日志目录总占用上限（MB）；超过后从最旧的日志开始删除，0 表示不限制，默认 500 */
  log_max_total_mb?: number;
  /** 真实 IP 头名称，用于反向代理场景，默认 X-Forwarded-For */
  real_ip_header?: string;
  /** 是否启用 HAProxy PROXY Protocol 支持 */
  haproxy_protocol?: boolean;
  /** TCP 连接速率限制：每 10 秒窗口内允许的最大连接数（默认 30） */
  connection_rate_limit?: number;
  /** 全服同时存在的房间数上限；未设置或 <1 表示不限制 */
  max_rooms?: number;
  /** 全服同时在线的 TCP 连接数上限；未设置或 <1 表示不限制 */
  max_connections?: number;
  /** 是否启用会话级命令限流（防刷屏/防对上游 API 放大），默认启用；设为 false 关闭（如内网/比赛） */
  command_rate_limit?: boolean;
  /** HTTP 请求速率限制：每窗口允许的最大请求数（默认 100） */
  http_rate_limit_max_requests?: number;
  /** HTTP 请求速率限制：时间窗口长度（毫秒，默认 60000 = 1分钟） */
  http_rate_limit_window_ms?: number;
  /** 服务端语言，影响日志/CLI/HTTP 默认输出语言，支持 zh-CN、en-US；未设置则按 PHIRA_MP_LANG / LANG 协商 */
  lang?: string;
  /** Phira API 端点地址，默认 https://phira.5wyxi.com */
  phira_api_endpoint?: string;
  /** 服务端出站代理配置：false 表示强制直连，字符串表示使用指定代理 */
  outbound_proxy?: string | false;
  /** 允许的 CORS 来源列表；空数组或未设置时允许所有来源（向后兼容，但建议生产环境配置具体来源） */
  cors_origins?: string[];
  /** 是否允许从 URL 查询参数（?token=）中提取管理 token；默认 false。启用会导致 token 出现在服务器日志中 */
  allow_token_in_query?: boolean;
  /** Phira Replay 分享站配置 */
  share_station?: ShareStationConfig;
  /** 是否启用游戏结束后自动上传回放到分享站，默认 false。需要同时配置 share_station 才能实际生效 */
  replay_auto_upload?: boolean;
  /** Redis 缓存配置 */
  redis?: RedisConfig;
  /** 一言 API 地址，默认 https://v1.hitokoto.cn/ */
  hitokoto_api_url?: string;
};

export type Chart = {
  id: number;
  name: string;
};

export type RecordData = {
  id: number;
  player: number;
  /**
   * 该成绩对应的谱面 ID（Phira API /record/:id 返回时携带）。
   * 用于在 Played 时校验成绩与房间当前谱面是否一致，防止用别的（更简单的）谱面成绩冒充。
   * 旧客户端 / API 未返回时为 undefined，此时跳过校验（fail-open，避免误伤正常玩家）。
   */
  chart?: number;
  score: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  max_combo: number;
  accuracy: number;
  full_combo: boolean;
  std: number;
  std_score: number;
};
