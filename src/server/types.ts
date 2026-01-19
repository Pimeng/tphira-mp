export type ServerConfig = {
  monitors: number[];
  server_name?: string;
  host?: string;
  port?: number;
  http_service?: boolean;
  http_port?: number;
  room_max_users?: number;
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
