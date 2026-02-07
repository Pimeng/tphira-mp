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
  /** 联邦（互通服）配置 */
  federation?: FederationConfig;
};

// ==================== 联邦（互通服）配置类型 ====================

/** 联邦对等服务器 */
export type FederationPeer = {
  /** 对等服务器名称（用于日志和显示） */
  name: string;
  /** TCP 地址，格式: "host:port" */
  address: string;
  /** HTTP API 地址，格式: "http://host:port" */
  http_address?: string;
};

/** 联邦配置 */
export type FederationConfig = {
  /** 是否启用联邦互通 */
  enabled: boolean;
  /**
   * 服务器间共享密钥
   * 用于 HMAC-SHA256-96 签名验证，所有互通服务器需使用相同密钥
   */
  shared_secret: string;
  /** 对等服务器列表 */
  peers: FederationPeer[];
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
