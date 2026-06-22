
create-id-occupied = 房間 ID 已被佔用

join-game-ongoing = 遊戲正在進行中
join-room-full = 房間已滿
join-room-locked = 房間已鎖定
join-cant-monitor = 權限不足，無法觀戰此房間

start-no-chart-selected = 尚未選擇譜面

http-not-found = 找不到
http-internal-error = 伺服器內部錯誤
http-rate-limited = 請求過於頻繁，請稍後重試

bad-enabled = 缺少 enabled 參數
auth-unauthorized = 未授權
token-expired = 權杖已過期
admin-disabled = 管理員功能未啟用
otp-disabled-when-token-configured = 已設定管理員權杖，OTP 功能已停用
bad-request = 請求參數錯誤
invalid-or-expired-session = 工作階段無效或已過期
ip-mismatch = IP 位址不符
pending-approval = 等待管理員核准
approval-denied = 提權申請已被拒絕
token-not-issued = 權杖未簽發
ip-banned-too-many-attempts = 該 IP 因嘗試次數過多已被封鎖
ssid-banned-too-many-attempts = 該工作階段因嘗試次數過多已被封鎖
invalid-or-expired-otp = 驗證碼無效或已過期
bad-token = 權杖不能為空
upload-failed = 上傳失敗
share-station-not-configured = 分享站未設定
upload-success = 上傳成功
user-must-be-disconnected = 使用者必須處於離線狀態
user-not-in-room = 使用者不在房間中
cannot-move-while-playing = 遊戲進行中無法移動使用者
target-room-not-idle = 目標房間不處於閒置狀態

cli-invalid-port = 連接埠號碼不合法
cli-invalid-http-service = HTTP_SERVICE 不合法
cli-invalid-http-port = HTTP 連接埠號碼不合法
cli-invalid-room-max-users = ROOM_MAX_USERS 不合法
cli-invalid-monitors = MONITORS 不合法

label-monitor-suffix = （觀戰者）
replay-recorder-name = 回放錄製器

chat-welcome = 「{ $userName }」你好！歡迎來到 { $serverName } 伺服器！
chat-welcome-version = 伺服器目前版本： { $version }
chat-hitokoto = { $quote } —— { $from }
chat-hitokoto-from-unknown = 佚名
chat-roomlist-title = 目前可用的房間如下：
chat-roomlist-empty = 目前沒有可用房間
chat-roomlist-item = { $id }（{ $count }/{ $max }）
chat-disabled-by-server = 為避免安全問題，該伺服器已停用聊天

chat-game-summary =
    本局結算：
    { $scoreText }
    { $accText }
    { $stdText }
chat-game-summary-score = 最高分：「{ $name } 」({ $id }) { $score }
chat-game-summary-acc = 最高準度：「{ $name } 」({ $id }) { $acc }
chat-game-summary-std = 最佳無瑕度：「{ $name } 」({ $id }) { $std }ms

auth-invalid-token = token 不合法
auth-fetch-me-failed = 取得使用者資訊失敗
auth-failed = 認證失敗
auth-invalid-response = 認證回應無效
auth-invalid-user-id = 認證回應中使用者ID無效
auth-invalid-user-name = 認證回應中使用者名稱無效
auth-repeated-authenticate = 重複認證
user-banned-by-server = 你已被伺服器封鎖，無法進行任何操作。

room-already-in-room = 已在房間中
room-creation-disabled = 房間建立功能已被管理員停用
rooms-limit-reached = 伺服器房間數量已達上限，請稍後再試
room-not-found = 房間不存在
room-no-room = 你不在房間中
room-banned = 你已被禁止進入房間 { $id }
room-not-whitelisted = 你不在該房間白名單中
room-only-host = 只有房主可以執行此操作
room-invalid-state = 房間狀態不允許此操作
room-already-ready = 已準備
room-not-ready = 未準備
room-game-aborted = 對局已中止

record-invalid = 記錄不合法
record-already-uploaded = 已上傳記錄
record-fetch-failed = 取得記錄失敗
record-chart-mismatch = 成績與當前譜面不匹配

command-rate-limited = 操作過於頻繁，請稍後再試

chart-fetch-failed = 取得譜面失敗

server-maintenance = 伺服器正在維護中，暫時無法加入
log-auth-rejected-maintenance = 維護模式：已拒絕新連線 “{ $user }”
chat-maintenance-enabled = ⚙️ 伺服器已進入維護模式，暫停新玩家加入，請盡快結束當前對局
chat-maintenance-disabled = ✅ 伺服器維護已結束，恢復正常
chat-server-stopping = ⚠️ 伺服器即將關閉維護，對局結束後連線將斷開
chat-waiting-reconnect = ⏳ “{ $user }” 異常斷線，正在等待重連，{ $seconds } 秒後仍未重連將結束本局
cli-maintenance-status = 維護模式：{ $state }
cli-usage-maintenance = 用法：maintenance <on|off|status> [提示訊息]

net-connection-closed = 連線已關閉
net-send-timeout = 傳送逾時
net-unsupported-protocol-version = 不支援的協定版本：{ $version }

roomid-empty = 房間 ID 不能為空
roomid-too-long = 房間 ID 過長
roomid-invalid = 房間 ID 不合法

frame-invalid-length = 長度不合法
frame-invalid-length-prefix = 長度前綴不合法
frame-payload-too-large = 資料封包過大

binary-unexpected-eof = 非預期的 EOF
binary-length-too-large = 長度過大
binary-string-too-long = 字串過長

proto-roomstate-tag-invalid = RoomState 標籤不合法
proto-users-key-missing = users 鍵不存在
proto-message-tag-invalid = Message 標籤不合法
proto-clientcommand-tag-invalid = ClientCommand 標籤不合法
proto-servercommand-tag-invalid = ServerCommand 標籤不合法

client-not-connected = 未連線
client-ping-in-flight = 上一次 ping 尚未完成
client-heartbeat-timeout = 心跳逾時
client-timeout = 逾時

log-new-connection = 收到新連線，連線ID：{ $id }，來源：{ $remote }
log-handshake-ok = 連線交握完成，連線ID：{ $id }，協定版本：「{ $version }」
log-handshake-failed = 連線交握失敗，連線ID：{ $id }：{ $reason }

log-server-version = 伺服端版本 { $version }
log-runtime-env = 目前執行環境 { $platform } node{ $node }
log-server-listen = 伺服端執行於 { $addr }
log-http-listen = HTTP 服務執行於 { $addr }
log-server-name = 伺服器名稱 { $name }
log-server-stopped = 伺服端已停止

log-heartbeat-timeout-disconnect = 心跳逾時，準備中斷連線（連線ID：{ $id }）
log-auth-ok = 連線ID：{ $id }，「 { $user } 」 { $monitorSuffix } 認證成功，協定版本：「{ $version }」
log-auth-failed = 連線ID：{ $id } 認證失敗：{ $reason }

log-player-join = 「{ $user }({ $id })」{ $monitorSuffix } 加入了伺服器

log-disconnect = 連線中斷，連線ID：{ $id } { $who }
log-disconnect-user = ，「{ $user }」

log-user-disconnect-playing = 「{ $user }」 對局中斷線，強制退出房間 「{ $room }」
log-room-recycled = 房間 「{ $room }」 已回收（無玩家）
log-user-dangle = 「{ $user }」 斷線，進入掛起等待重連
log-user-dangle-timeout-remove = 「{ $user }」 掛起逾時，移除使用者並退出房間 「{ $room }」

log-user-chat = 「{ $user }」 在房間 「{ $room }」 傳送聊天訊息
log-user-touches = 「{ $user }」 在房間 「{ $room }」 回報觸控影格 { $count } 條
log-user-judges = 「{ $user }」 在房間 「{ $room }」 回報判定事件 { $count } 條

log-room-created = 「{ $user }」 建立房間 「{ $room }」
log-room-joined = 「{ $user }」{ $suffix } 加入房間 「{ $room }」
log-room-left = 「{ $user }」{ $suffix } 離開房間 「{ $room }」

log-msg-create-room = { $user } 建立了房間
log-msg-join-room = { $name } 加入了房間
log-msg-leave-room = { $name } 離開了房間
log-msg-new-host = { $user } 成為了新的房主
log-msg-select-chart = 房主 { $user } 選擇了譜面 { $name } (#{ $id })
log-msg-game-start = 房主 { $user } 開始了遊戲，請其他玩家準備
log-msg-ready = { $user } 已就緒
log-msg-cancel-ready = { $user } 取消了準備
log-msg-cancel-game = { $user } 取消了對局
log-msg-start-playing = 遊戲開始
log-msg-played = { $user } 結束了遊玩：{ $score } ({ $acc }%){ $fc ->
    [true] ，全連
   *[false] {""}
}
log-msg-game-end = 遊戲結束
log-msg-abort = { $user } 放棄了遊戲
log-msg-lock-room = { $lock ->
    [true] 房間已鎖定
   *[false] 房間已解鎖
}
log-msg-cycle-room = { $cycle ->
    [true] 房間已切換為循環模式
   *[false] 房間已切換為一般模式
}

log-room-lock = 「{ $user }」 將房間 「{ $room }」{ $lock ->
    [true] 設為鎖定
   *[false] 取消鎖定
  }

log-room-cycle = 「{ $user }」 將房間 「{ $room }」{ $cycle ->
    [true] 開啟輪轉房主
   *[false] 關閉輪轉房主
  }

log-room-select-chart = 「{ $user }」（使用者ID：{ $userId }）在房間 「{ $room }」 選擇了 「{ $chart }」
log-room-request-start = 「{ $user }」 在房間 「{ $room }」 請求開始對局
log-room-ready = 「{ $user }」 在房間 「{ $room }」 已準備
log-room-cancel-game = 「{ $user }」 在房間 「{ $room }」 取消了對局
log-room-cancel-ready = 「{ $user }」 在房間 「{ $room }」 取消準備
log-room-played = 「{ $user }」 在房間 「{ $room }」 完成遊玩並上傳記錄（分數：{ $score }，Acc：{ $acc }）
log-room-abort = 「{ $user }」 在房間 「{ $room }」 中止了對局

log-room-host-changed-offline = 房間 「{ $room }」 房主變更（離線）：{ $old } -> { $next }
log-room-game-start = 房間 「{ $room }」 對局開始，玩家：{ $users }{ $monitorsSuffix }
log-room-game-start-monitors = ，觀戰者：{ $monitors }
log-room-game-end = 房間 「{ $room }」 對局結束（已上傳：{ $uploaded }，中止：{ $aborted }）
log-contest-game-results = 比賽房間 「{ $room }」 成績：chart={ $chart } results={ $results } aborted={ $aborted }
log-room-host-changed-cycle = 房間 「{ $room }」 房主變更（輪轉）：{ $old } -> { $next }

log-admin-broadcast = 管理員全服廣播：{ $message }（傳送到 { $rooms } 個房間）
log-gui-console-command = GUI 控制台執行命令：{ $command }
log-gui-http-forced = 已啟用 GUI，HTTP 服務已自動開啟
log-gui-window-launched = GUI 視窗已開啟：{ $url }
log-gui-window-failed = 無法自動開啟 GUI 視窗，請在本機瀏覽器開啟：{ $url }
log-admin-room-message = 管理員向房間 "{ $room }" 傳送訊息：{ $message }
log-room-disbanded-by-admin = 房間 "{ $room }" 已被管理員解散

room-disbanded-by-admin = 房間已被管理員解散

log-websocket-connected = WebSocket 用戶端已連線，目前連線數：{ $total }
log-websocket-disconnected = WebSocket 用戶端已中斷，目前連線數：{ $total }

# ====== CLI 主控台 ======

cli-bad-user-id = 無效的使用者ID
cli-bad-room-id = 無效的房間ID
cli-message-empty = 訊息不能為空
cli-message-too-long = 訊息過長（最多 { $max } 字元）

cli-stop-hint = 使用 Ctrl+C 停止伺服器
cli-stopping = 正在關閉伺服器，請稍候……
locales-fetched = 已在線補齊 { $count } 個語言檔
locales-override-applied = 已套用 locales/{ $lang }.ftl 覆寫（{ $count } 個鍵）
config-auto-created = 未找到設定檔，已產生預設設定：{ $path }（請依需求修改後重新啟動生效）
http-admin-token-missing = HTTP 服務已啟用但未設定 ADMIN_TOKEN，/admin 介面將全部拒絕存取；可在 CLI 用 pending / approve 臨時授權，或在設定中設定 ADMIN_TOKEN
cli-unknown-command = 未知命令：{ $cmd }。輸入 'help' 檢視可用命令
cli-command-failed = 命令執行失敗：{ $reason }

cli-help =

    === Phira MP 伺服器命令 ===
    help                          - 顯示此說明資訊
    list, rooms                   - 列出所有房間
    users                         - 列出所有線上使用者
    user <id>                     - 檢視使用者資訊
    kick <userId> [preserve]      - 踢出使用者（preserve=true 保留房間槽位）
    ban <userId>                  - 在伺服器封鎖使用者
    unban <userId>                - 解封使用者
    banlist                       - 檢視封鎖列表
    banroom <userId> <roomId>     - 禁止使用者進入房間
    unbanroom <userId> <roomId>   - 解除房間禁入
    broadcast <message>           - 全服廣播
    say <message>                 - 全服廣播（broadcast 別名）
    roomsay <roomId> <message>    - 向指定房間傳送訊息
    maxusers <roomId> <count>     - 設定房間最大人數
    disband <roomId>              - 解散房間
    replay <on|off|status>        - 回放錄製開關
    roomcreation <on|off|status>  - 房間建立開關
    maintenance <on|off|status> [訊息]  - 維護模式開關（暫停新玩家加入）
    contest <roomId> <subcommand> - 比賽房間管理
      contest <roomId> enable [userIds...]    - 啟用比賽模式
      contest <roomId> disable                - 停用比賽模式
      contest <roomId> whitelist <userIds...> - 設定白名單
      contest <roomId> start [force]          - 手動開始比賽
    ipblacklist <list|remove|clear> - IP 黑名單管理
    pending                       - 列出所有待處理的 CLI 提權申請
    approve <ssid>                - 核准 CLI 提權申請並簽發臨時 TOKEN（支援 ssid 前綴短碼）
    deny <ssid>                   - 拒絕 CLI 提權申請（支援 ssid 前綴短碼）
    stop, shutdown                - 優雅關閉伺服器

cli-no-rooms = 目前沒有房間
cli-rooms-total = 房間總數：{ $count }
cli-room-line = [{ $id }] { $state } | 玩家：{ $users }/{ $maxUsers } | 觀戰：{ $monitors } | 譜面：{ $chart } | 鎖定：{ $locked } | 循環：{ $cycle } | 比賽：{ $contest }

cli-no-users = 目前沒有線上使用者
cli-users-total = 線上使用者總數：{ $count }
cli-user-line = [{ $id }] { $name } | { $status } | { $role } | 房間：{ $room }{ $bannedTag }
cli-user-status-online = 線上
cli-user-status-offline = 離線
cli-user-role-monitor = 觀戰
cli-user-role-player = 玩家
cli-user-banned-tag =  [已封鎖]
cli-none = 無
cli-yes = 是
cli-no = 否
cli-state-on = 開啟
cli-state-off = 關閉
cli-room-state-playing = 遊戲中
cli-room-state-waiting = 等待準備
cli-room-state-select = 選擇譜面
cli-bool-yes = 是
cli-bool-no = 否

cli-usage-user = 用法：user <userId>
cli-usage-kick = 用法：kick <userId> [preserve]
cli-usage-ban = 用法：ban <userId>
cli-usage-unban = 用法：unban <userId>
cli-usage-banroom = 用法：banroom <userId> <roomId>
cli-usage-unbanroom = 用法：unbanroom <userId> <roomId>
cli-usage-broadcast = 用法：broadcast <message>
cli-usage-roomsay = 用法：roomsay <roomId> <message>
cli-usage-maxusers = 用法：maxusers <roomId> <count>
cli-usage-disband = 用法：disband <roomId>
cli-usage-replay = 用法：replay <on|off|status>
cli-usage-roomcreation = 用法：roomcreation <on|off|status>
cli-usage-contest = 用法：contest <roomId> <enable|disable|whitelist|start>
cli-usage-ipblacklist = 用法：ipblacklist <list|remove|clear>
cli-usage-ipblacklist-remove = 用法：ipblacklist remove <ip>

cli-user-not-found = 使用者不存在：{ $id }
cli-user-info-header = 使用者資訊：
cli-user-info-id =   ID：{ $id }
cli-user-info-name =   名稱：{ $name }
cli-user-info-status =   狀態：{ $status }
cli-user-info-role =   角色：{ $role }
cli-user-info-room =   房間：{ $room }
cli-user-info-banned =   封鎖：{ $banned }
cli-user-info-game-time =   遊戲時間：{ $time }
cli-user-info-language =   語言：{ $lang }

cli-user-not-connected = 使用者未連線：{ $id }
cli-user-kicked = 已踢出使用者：{ $id }
cli-user-banned = 已封鎖使用者：{ $id }
cli-user-unbanned = 已解封使用者：{ $id }
cli-no-banned-users = 目前沒有被封鎖的使用者
cli-banned-list-header = 封鎖使用者列表（共 { $count } 個）：
cli-room-user-banned = 已禁止使用者 { $userId } 進入房間 { $room }
cli-room-user-unbanned = 已解除使用者 { $userId } 對房間 { $room } 的禁入
cli-broadcast-sent = 已向 { $count } 個房間廣播訊息
cli-room-not-found = 房間不存在
cli-room-not-found-named = 房間不存在：{ $room }
cli-room-message-sent = 已向房間 { $room } 傳送訊息
cli-bad-max-users = 無效的人數（1-64）
cli-room-max-users-set = 已設定房間 { $room } 最大人數為 { $count }
cli-room-disbanded = 已解散房間 { $room }

cli-replay-status = 回放錄製狀態：{ $state }
cli-replay-toggled-on = 回放錄製已開啟
cli-replay-toggled-off = 回放錄製已關閉
cli-room-creation-status = 房間建立狀態：{ $state }
cli-room-creation-toggled-on = 房間建立已開啟
cli-room-creation-toggled-off = 房間建立已關閉

cli-contest-enabled = 已啟用房間 { $room } 的比賽模式
cli-contest-disabled = 已停用房間 { $room } 的比賽模式
cli-contest-no-user-id = 請提供至少一個使用者ID
cli-contest-not-enabled = 房間不存在或未啟用比賽模式
cli-contest-whitelist-updated = 已更新房間 { $room } 的白名單
contest-room-not-found = 比賽房間不存在
room-not-waiting = 房間不在等待準備狀態
no-chart-selected = 未選擇譜面
not-all-ready = 並非所有玩家都已準備
cli-contest-cannot-start = 無法開始比賽：{ $reason }
cli-contest-started = 已開始房間 { $room } 的比賽
cli-contest-unknown-subcommand = 未知子命令。可用：enable、disable、whitelist、start

cli-blacklist-empty = IP 黑名單為空
cli-blacklist-header = IP 黑名單（共 { $count } 個）：
cli-blacklist-line =   { $ip }（{ $minutes } 分鐘後過期）
cli-blacklist-removed = 已從黑名單移除：{ $ip }
cli-blacklist-cleared = 已清空 IP 黑名單
cli-ipblacklist-unknown-subcommand = 未知子命令。可用：list、remove、clear

cli-usage-approve = 用法：approve <ssid>（支援完整 ssid 或前綴短碼）
cli-usage-deny = 用法：deny <ssid>（支援完整 ssid 或前綴短碼）
cli-approve-not-found = 找不到符合的提權申請：{ $input }
cli-approve-ambiguous = 短碼 { $input } 符合多個提權申請，請提供更長的前綴
cli-approve-expired = 提權申請 { $ssid } 已過期
cli-approve-already-handled = 提權申請 { $ssid } 已處於 { $status } 狀態，無法再次處理
cli-approve-success = 已核准提權申請 { $ssid }（請求IP：{ $ip }），臨時 TOKEN 已簽發
cli-deny-success = 已拒絕提權申請 { $ssid }（請求IP：{ $ip }）
cli-pending-empty = 目前沒有待處理的 CLI 提權申請
cli-pending-header = 待處理的 CLI 提權申請（共 { $count } 個）：
cli-pending-line =   [{ $ssid }] 完整 ssid: { $full } | 請求IP: { $ip } | 剩餘 { $seconds } 秒
