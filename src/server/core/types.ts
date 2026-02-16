export type ServerConfig = {
  monitors: number[];
  /** 测试账号 ID 列表：配置后，这些账号的日志不写入文件（仅当全局日志等级非 DEBUG 时）；不配置或为空数组则所有人日志都写入文件。默认 [1739989] */
  test_account_ids?: number[];
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
  /** 日志等级（DEBUG, INFO, MARK, WARN, ERROR），默认 INFO */
  log_level?: string;
  /** 真实 IP 头名称（用于反向代理场景），默认 X-Forwarded-For */
  real_ip_header?: string;
  /** 是否启用 HAProxy PROXY Protocol 支持 */
  haproxy_protocol?: boolean;
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
