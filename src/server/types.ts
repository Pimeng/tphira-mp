export type ServerConfig = {
  monitors: number[];
  server_name?: string;
  host?: string;
  port?: number;
  http_service?: boolean;
  http_port?: number;
  room_max_users?: number;
  replay_enabled?: boolean;
  admin_token?: string;
  admin_data_path?: string;
  room_list_tip?: string;
  /** Redis 分布式状态：host (默认 127.0.0.1) */
  redis_host?: string;
  /** Redis 端口 (默认 6379) */
  redis_port?: number;
  /** Redis 数据库 ID (默认 0) */
  redis_db?: number;
  /** Redis 密码（可选） */
  redis_password?: string;
  /** 当前边缘服务器 ID，用于 Redis 玩家会话 */
  server_id?: string;
  /** 写入日志文件的最小等级（DEBUG/INFO/MARK/WARN/ERROR），可与 LOG_LEVEL 环境变量一并使用 */
  log_level?: string;
  /** 输出到终端的最小等级，可与 CONSOLE_LOG_LEVEL 环境变量一并使用 */
  console_log_level?: string;
};

export type Chart = {
  id: number;
  name: string;
};

export type RecordData = {
  id: number;
  player: number;
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
