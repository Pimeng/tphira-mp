
create-id-occupied = 房间 ID 已被占用

join-game-ongoing = 游戏正在进行中
join-room-full = 房间已满
join-room-locked = 房间已锁定
join-cant-monitor = 权限不足，不能旁观房间

start-no-chart-selected = 还没有选择谱面

http-not-found = 未找到
http-internal-error = 服务器内部错误

cli-invalid-port = 端口号不合法
cli-invalid-http-service = HTTP_SERVICE 不合法
cli-invalid-http-port = HTTP 端口号不合法
cli-invalid-room-max-users = ROOM_MAX_USERS 不合法
cli-invalid-monitors = MONITORS 不合法

label-monitor-suffix = （观战者）

chat-welcome = "{ $userName }"你好！欢迎来到 { $serverName } 服务器！
chat-hitokoto = { $quote } —— { $from }
chat-hitokoto-from-unknown = 佚名
chat-hitokoto-unavailable = 一言获取失败
chat-roomlist-title = 当前可用的房间如下：
chat-roomlist-empty = 当前没有可用房间
chat-roomlist-item = { $id }（{ $count }/{ $max }）

chat-game-summary =
    本局结算：
    { $scoreText }
    { $accText }
    { $stdText }
chat-game-summary-score = 最高分：“{ $name } ”({ $id }) { $score }
chat-game-summary-acc = 最高准度：“{ $name } ”({ $id }) { $acc }
chat-game-summary-std = 最佳无瑕度：“{ $name } ”({ $id }) { $std }ms

auth-invalid-token = token 不合法
auth-fetch-me-failed = 获取用户信息失败
auth-account-already-online = 连接过快，请等待5秒后再试
auth-failed = 认证失败
auth-repeated-authenticate = 重复认证
auth-banned = 你已被封禁，无法进入服务器
user-banned-by-server = 你已被服务器封禁，无法进行任何操作。

room-already-in-room = 已在房间中
room-creation-disabled = 房间创建功能已被管理员禁用
room-not-found = 房间不存在
room-no-room = 你不在房间中
room-banned = 你已被禁止进入房间 { $id }
room-not-whitelisted = 你不在该房间白名单中
room-only-host = 只有房主可以执行此操作
room-invalid-state = 房间状态不允许此操作
room-already-ready = 已准备
room-not-ready = 未准备
room-game-aborted = 对局已中止

record-invalid = 记录不合法
record-already-uploaded = 已上传记录
record-fetch-failed = 获取记录失败

chart-fetch-failed = 获取谱面失败

net-request-timeout = 请求超时
net-connection-closed = 连接已关闭
net-send-timeout = 发送超时
net-unsupported-protocol-version = 不支持的协议版本：{ $version }

roomid-empty = 房间 ID 不能为空
roomid-too-long = 房间 ID 过长
roomid-invalid = 房间 ID 不合法

frame-invalid-length = 长度不合法
frame-invalid-length-prefix = 长度前缀不合法
frame-payload-too-large = 数据包过大

binary-unexpected-eof = 意外的 EOF
binary-length-too-large = 长度过大
binary-string-too-long = 字符串过长

proto-roomstate-tag-invalid = RoomState 标签不合法
proto-users-key-missing = users 键不存在
proto-message-tag-invalid = Message 标签不合法
proto-clientcommand-tag-invalid = ClientCommand 标签不合法
proto-servercommand-tag-invalid = ServerCommand 标签不合法

client-not-connected = 未连接
client-ping-in-flight = 上一次 ping 尚未完成
client-heartbeat-timeout = 心跳超时
client-timeout = 超时

log-new-connection = 收到新连接，连接ID：{ $id }，来源：{ $remote }
log-handshake-ok = 连接握手完成，连接ID：{ $id }，协议版本：“{ $version }”
log-handshake-failed = 连接握手失败，连接ID：{ $id }：{ $reason }

log-server-version = 服务端版本 { $version }
log-runtime-env = 当前运行环境 { $platform } node{ $node }
log-server-listen = 服务端运行在 { $addr }
log-http-listen = HTTP 服务运行在 { $addr }
log-server-name = 服务器名称 { $name }
log-server-stopped = 服务端已停止

log-heartbeat-timeout-disconnect = 心跳超时，准备断开连接（连接ID：{ $id }）
log-auth-ok = 连接ID：{ $id }，“ { $user } ” { $monitorSuffix } 认证成功，协议版本：“{ $version }”
log-auth-failed = 连接ID：{ $id } 认证失败：{ $reason }

log-player-join = “{ $user }({ $id })”{ $monitorSuffix } 加入了服务器

log-disconnect = 连接断开，连接ID：{ $id } { $who }
log-disconnect-user = ，“{ $user }”

log-user-disconnect-playing = “{ $user }” 对局中断线，强制退出房间 “{ $room }”
log-room-recycled = 房间 “{ $room }” 已回收（无玩家）
log-user-dangle = “{ $user }” 断线，进入挂起等待重连
log-user-dangle-timeout-remove = “{ $user }” 挂起超时，移除用户并退出房间 “{ $room }”

log-user-chat = “{ $user }” 在房间 “{ $room }” 发送聊天消息
log-user-touches = “{ $user }” 在房间 “{ $room }” 上报触控帧 { $count } 条
log-user-judges = “{ $user }” 在房间 “{ $room }” 上报判定事件 { $count } 条

log-room-created = “{ $user }” 创建房间 “{ $room }”
log-room-joined = “{ $user }”{ $suffix } 加入房间 “{ $room }”
log-room-left = “{ $user }”{ $suffix } 离开房间 “{ $room }”

log-room-lock = “{ $user }” 将房间 “{ $room }”{ $lock ->
    [true] 设为锁定
   *[false] 取消锁定
  }

log-room-cycle = “{ $user }” 将房间 “{ $room }”{ $cycle ->
    [true] 开启轮转房主
   *[false] 关闭轮转房主
  }

log-room-select-chart = “{ $user }”（用户ID：{ $userId }）在房间 “{ $room }” 选择了 “{ $chart }”
log-room-request-start = “{ $user }” 在房间 “{ $room }” 请求开始对局
log-room-ready = “{ $user }” 在房间 “{ $room }” 已准备
log-room-cancel-game = “{ $user }” 在房间 “{ $room }” 取消了对局
log-room-cancel-ready = “{ $user }” 在房间 “{ $room }” 取消准备
log-room-played = “{ $user }” 在房间 “{ $room }” 完成游玩并上传记录（分数：{ $score }，Acc：{ $acc }）
log-room-abort = “{ $user }” 在房间 “{ $room }” 中止了对局

log-room-host-changed-offline = 房间 “{ $room }” 房主变更（离线）：{ $old } -> { $next }
log-room-game-start = 房间 “{ $room }” 对局开始，玩家：{ $users }{ $monitorsSuffix }
log-room-game-start-monitors = ，观战者：{ $monitors }
log-room-game-end = 房间 “{ $room }” 对局结束（已上传：{ $uploaded }，中止：{ $aborted }）
log-contest-game-results = 比赛房间 “{ $room }” 成绩：chart={ $chart } results={ $results } aborted={ $aborted }
log-room-host-changed-cycle = 房间 “{ $room }” 房主变更（轮转）：{ $old } -> { $next }

log-admin-broadcast = 管理员全服广播：{ $message }（发送到 { $rooms } 个房间）
log-admin-room-message = 管理员向房间 "{ $room }" 发送消息：{ $message }
log-room-disbanded-by-admin = 房间 "{ $room }" 已被管理员解散

room-disbanded-by-admin = 房间已被管理员解散
